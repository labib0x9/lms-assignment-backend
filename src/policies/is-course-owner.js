'use strict';

/**
 * `is-course-owner` policy
 * - create (POST /api/courses): Allows admin, content_manager, and instructor
 * - update / delete (PUT/DELETE /api/courses/:id): Allows admin, content_manager, or the instructor who owns the course
 */

module.exports = async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false; // Blocks unauthenticated requests

  const userRole = user.role?.type;

  // 1. Admins and Content Managers have global access
  if (userRole === 'admin' || userRole === 'content_manager' || userRole === 'content manager') {
    return true;
  }

  // 2. Instructors:
  if (userRole === 'instructor') {
    const { id } = policyContext.params;

    // During course creation (POST /api/courses), there is no :id parameter yet -> ALLOW
    if (!id) {
      return true;
    }

    // For update / delete (PUT/DELETE /api/courses/:id), verify ownership
    const course = await strapi.documents('api::course.course').findOne({
      documentId: id,
      populate: ['Instructors'],
    });

    if (!course) return false;

    // Check if the logged-in user is one of the instructors of this course
    const isOwner = course.Instructors?.some((inst) => inst.id === user.id);
    return Boolean(isOwner);
  }

  // Any other role is forbidden
  return false;
};
