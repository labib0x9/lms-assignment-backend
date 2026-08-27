'use strict';

/**
 * `can-view-lesson` policy
 * - Admin & Content Manager: Full access
 * - Instructor: Access granted if user is an instructor of the parent course
 * - Student: Access granted only if enrolled in the parent course
 * - Unauthenticated: Blocked (403 Forbidden)
 */

module.exports = async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false; // Must be authenticated

  const userRole = user.role?.type;

  // 1. Admins and Content Managers have global access
  if (userRole === 'admin' || userRole === 'content_manager') {
    return true;
  }

  const { id } = policyContext.params || {};
  if (!id) return false;

  // 2. Fetch the target lesson with its parent course
  const lesson = await strapi.documents('api::lesson.lesson').findOne({
    documentId: id,
    populate: {
      course: {
        fields: ['id', 'documentId', 'title'],
        populate: {
          Instructors: {
            fields: ['id', 'documentId', 'username', 'email'],
          },
        },
      },
    },
  });

  if (!lesson) return false;

  const lessonObj = typeof lesson === 'object' && lesson !== null ? lesson : {};
  const parentCourse = lessonObj['course'];
  if (!parentCourse) return false;

  // 3. Instructor check: Must be an author of this course
  if (userRole === 'instructor') {
    const instructors = parentCourse.Instructors || [];
    const isOwner = instructors.some(
      (inst) =>
        inst.id === user.id ||
        (user.documentId && inst.documentId === user.documentId)
    );
    return Boolean(isOwner);
  }

  // 4. Student check: Must have an active enrollment in this course
  if (userRole === 'student') {
    const enrollment = await strapi.documents('api::enroll.enroll').findFirst({
      filters: {
        user: {
          id: user.id,
        },
        course: {
          documentId: parentCourse.documentId,
        },
      },
    });

    return Boolean(enrollment);
  }

  return false;
};
