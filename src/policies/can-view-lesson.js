'use strict';

/**
 * `can-view-lesson` policy
 * - Admin, Instructor & Content Manager: Full access
 * - Student: Access granted only if enrolled in the parent course
 * - Unauthenticated: Blocked (403 Forbidden)
 */

module.exports = async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false;

  const userRole = user.role?.type;

  if (userRole === 'admin' || userRole === 'content_manager' || userRole === 'instructor') {
    return true;
  } else if (userRole !== 'student') {
    return false;
  }

  const { id } = policyContext.params || {};
  if (!id) return false;

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
};
