'use strict';

/**
 * `is-lesson-owner` policy
 * - create (POST /api/lessons): Verifies the instructor owns the parent course passed in request body
 * - update / delete (PUT/DELETE /api/lessons/:id): Verifies the instructor owns the lesson's parent course
 * - admin & content_manager: Allowed global access
 */

module.exports = async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false; // Blocks unauthenticated requests

  const userRole = user.role?.type;

  // 1. Admins and Content Managers have global access
  if (userRole === 'admin' || userRole === 'content_manager') {
    return true;
  }

  // 2. Instructors: Verify ownership of the parent course
  if (userRole === 'instructor') {
    const { id } = policyContext.params || {};

    // CASE A: Creating a new lesson (POST /api/lessons)
    if (!id) {
      const koaCtx = strapi.requestContext.get();
      const body =
        policyContext.request?.body ||
        koaCtx?.request?.body ||
        policyContext.args?.[0]?.request?.body ||
        {};
      const bodyData = body.data || body;

      const courseParam =
        bodyData.course?.documentId ||
        bodyData.course?.id ||
        bodyData.course;

      if (!courseParam) {
        return false; // Must provide a target parent course
      }

      // Look up parent course by documentId or database ID
      let course = null;
      if (typeof courseParam === 'string') {
        course = await strapi.documents('api::course.course').findOne({
          documentId: courseParam,
          populate: ['Instructors'],
        });
      } else if (typeof courseParam === 'number') {
        course = await strapi.db.query('api::course.course').findOne({
          where: { id: courseParam },
          populate: ['Instructors'],
        });
      }

      if (!course) return false;

      // Check if logged-in instructor is assigned to this parent course
      const isOwner = course.Instructors?.some(
        (inst) =>
          inst.id === user.id ||
          (user.documentId && inst.documentId === user.documentId)
      );

      return Boolean(isOwner);
    }

    // CASE B: Updating or Deleting an existing lesson (PUT/DELETE /api/lessons/:id)
    const lesson = await strapi.documents('api::lesson.lesson').findOne({
      documentId: id,
      populate: {
        course: {
          populate: ['Instructors'],
        },
      },
    });

    if (!lesson || !lesson.course) return false;

    // Check if logged-in instructor owns the parent course
    const isOwner = lesson.course.Instructors?.some(
      (inst) =>
        inst.id === user.id ||
        (user.documentId && inst.documentId === user.documentId)
    );
    return Boolean(isOwner);
  }

  // Any other role (e.g. students) is forbidden
  return false;
};
