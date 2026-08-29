'use strict';

/**
 * `is-lesson-owner` policy
 * - create (POST /api/lessons): Verifies the instructor owns the parent course passed in request body
 * - update / delete (PUT/DELETE /api/lessons/:id): Verifies the instructor owns the lesson's parent course
 * - admin & content_manager: Allowed global access
 */

module.exports = async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false;

  const userRole = user.role?.type;

  if (userRole === 'admin' || userRole === 'content_manager') {
    return true;
  } else if (userRole !== 'instructor') {
    return false
  }

  const { id } = policyContext.params || {};

  // create new lesson
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

    const isOwner = course.Instructors?.some(
      (inst) =>
        inst.id === user.id ||
        (user.documentId && inst.documentId === user.documentId)
    );

    return Boolean(isOwner);
  }

  // Updating or Deleting an existing lesson
  const lesson = await strapi.documents('api::lesson.lesson').findOne({
    documentId: id,
    populate: {
      course: {
        populate: ['Instructors'],
      },
    },
  });

  if (!lesson || !lesson.course) return false;

  const isOwner = lesson.course.Instructors?.some(
    (inst) =>
      inst.id === user.id ||
      (user.documentId && inst.documentId === user.documentId)
  );
  return Boolean(isOwner);
};
