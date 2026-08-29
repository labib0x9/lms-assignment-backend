'use strict';

/**
 * `is-course-owner` policy
 * - create (POST /api/courses): Allows admin, content_manager, and instructor
 * - update / delete (PUT/DELETE /api/courses/:id): Allows admin, content_manager, or the instructor who owns the course
 */

module.exports = async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false;

  const userRole = user.role?.type;

  if (userRole === 'admin' || userRole === 'content_manager') {
    return true;
  } else if (userRole !== 'instructor') {
    return false;
  }

  const { id } = policyContext.params;

  if (!id) {
    return true;
  }

  const course = await strapi.documents('api::course.course').findOne({
    documentId: id,
    populate: ['Instructors'],
  });

  if (!course) return false;

  const isOwner = course.Instructors?.some((inst) => inst.id === user.id);
  return Boolean(isOwner);

};
