'use strict';

/**
 * enroll controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::enroll.enroll', ({ strapi }) => ({
  // GET /api/enrolls (List enrollments - role scoped)
  async find(ctx) {
    return handleFind(this, ctx, strapi);
  },

  // GET /api/enrolls/:id (Single enrollment record)
  async findOne(ctx) {
    return handleFindOne(this, ctx, strapi);
  },

  // POST /api/enrolls (Student Enroll Action)
  async create(ctx) {
    return handleCreate(this, ctx, strapi);
  },

  // DELETE /api/enrolls/:id (Unenroll & clean up course progress)
  async delete(ctx) {
    return handleDelete(this, ctx, strapi);
  },
}));

// =========================================================
// 🛠️ HELPER FUNCTIONS
// =========================================================

function formatEnrollmentItem(enroll, sanitized) {
  const sanitizedObj = typeof sanitized === 'object' && sanitized !== null ? sanitized : {};
  const enrollObj = typeof enroll === 'object' && enroll !== null ? enroll : {};
  const course = enrollObj.course;
  const student = enrollObj.user;

  return {
    ...sanitizedObj,
    course:
      course && typeof course === 'object'
        ? {
          id: course.id,
          documentId: course.documentId,
          title: course.title,
          price: course.price,
          description: course.description,
        }
        : null,
    user:
      student && typeof student === 'object'
        ? {
          id: student.id,
          documentId: student.documentId,
          username: student.username,
          email: student.email,
        }
        : null,
  };
}

async function resolveUserDocId(strapi, user) {
  if (user.documentId) return user.documentId;
  const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: user.id },
  });
  return fullUser?.documentId || user.id;
}

/**
 * 1. GET /api/enrolls
 * Lists enrollments filtered by user role:
 * - Student: Only their own enrollments
 * - Instructor: Only enrollments in courses they teach
 * - Admin / Content Manager: All enrollments
 */
async function handleFind(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to view enrollments.');

  const userRole = user.role?.type;
  await controller.validateQuery(ctx);
  const sanitizedQuery = await controller.sanitizeQuery(ctx);

  const queryFilters =
    typeof sanitizedQuery.filters === 'object' && sanitizedQuery.filters !== null
      ? sanitizedQuery.filters
      : {};

  let scopedFilters = { ...queryFilters };

  if (userRole === 'student') {
    scopedFilters = {
      ...scopedFilters,
      user: { id: user.id },
    };
  } else if (userRole === 'instructor') {
    scopedFilters = {
      ...scopedFilters,
      course: { Instructors: { id: user.id } },
    };
  }

  const results = await strapi.documents('api::enroll.enroll').findMany({
    filters: scopedFilters,
    populate: {
      course: { fields: ['id', 'documentId', 'title', 'price', 'description'] },
      user: { fields: ['id', 'documentId', 'username', 'email'] },
    },
  });

  const sanitizedResults = await controller.sanitizeOutput(results, ctx);
  const formattedData = (results || []).map((enroll, index) => {
    const sanitized = Array.isArray(sanitizedResults)
      ? sanitizedResults[index]
      : sanitizedResults;
    return formatEnrollmentItem(enroll, sanitized);
  });

  return controller.transformResponse(formattedData);
}

/**
 * 2. GET /api/enrolls/:id
 * Fetches a single enrollment record with ownership verification
 */
async function handleFindOne(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to view enrollment details.');

  const { id } = ctx.params;
  const userRole = user.role?.type;

  await controller.validateQuery(ctx);
  const sanitizedQuery = await controller.sanitizeQuery(ctx);

  const entity = await strapi.documents('api::enroll.enroll').findOne({
    documentId: id,
    ...(typeof sanitizedQuery === 'object' && sanitizedQuery !== null ? sanitizedQuery : {}),
    populate: {
      course: { fields: ['id', 'documentId', 'title', 'price', 'description'] },
      user: { fields: ['id', 'documentId', 'username', 'email'] },
    },
  });

  if (!entity) return ctx.notFound('Enrollment record not found.');

  // Students can only view their own enrollment
  if (userRole === 'student' && entity.user?.id !== user.id) {
    return ctx.forbidden('You do not have permission to view this enrollment.');
  }

  const sanitizedEntity = await controller.sanitizeOutput(entity, ctx);
  const formattedData = formatEnrollmentItem(entity, sanitizedEntity);

  return controller.transformResponse(formattedData);
}

/**
 * Student enrollment action with duplicate protection
 */
async function handleCreate(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to enroll in a course.');

  const body = ctx.request.body || {};
  const bodyData =
    body && typeof body === 'object' && typeof body.data === 'object' && body.data !== null
      ? body.data
      : {};

  const courseParam = bodyData.course?.documentId || bodyData.course;
  if (!courseParam) {
    return ctx.badRequest('Please provide a valid course identifier to enroll.');
  }

  let targetCourse = await strapi.documents('api::course.course').findOne({
    documentId: String(courseParam),
  });

  if (!targetCourse) {
    const numericId = parseInt(courseParam, 10);
    if (!isNaN(numericId)) {
      targetCourse = await strapi.db.query('api::course.course').findOne({
        where: { id: numericId },
      });
    }
  }

  if (!targetCourse) {
    return ctx.notFound('The selected course was not found.');
  }

  const userDocId = await resolveUserDocId(strapi, user);

  const existingEnrollment = await strapi.documents('api::enroll.enroll').findFirst({
    filters: {
      user: { id: user.id },
      course: { documentId: targetCourse.documentId },
    },
  });

  if (existingEnrollment) {
    return ctx.badRequest('You are already enrolled in this course.');
  }

  const entity = await strapi.documents('api::enroll.enroll').create({
    data: {
      user: userDocId,
      course: targetCourse.documentId,
      enrolled_at: new Date().toISOString(),
    },
    populate: {
      course: { fields: ['id', 'documentId', 'title', 'price', 'description'] },
      user: { fields: ['id', 'documentId', 'username', 'email'] },
    },
  });

  const sanitizedEntity = await controller.sanitizeOutput(entity, ctx);
  const formattedData = formatEnrollmentItem(entity, sanitizedEntity);

  ctx.status = 201;
  return controller.transformResponse(formattedData);
}

/**
 * 4. DELETE /api/enrolls/:id
 * Unenrolls a student and cleans up their progress records for that course
 */
async function handleDelete(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to unenroll.');

  const { id } = ctx.params;
  const userRole = user.role?.type;

  const entity = await strapi.documents('api::enroll.enroll').findOne({
    documentId: id,
    populate: {
      user: { fields: ['id', 'documentId'] },
      course: { fields: ['id', 'documentId'] },
    },
  });

  if (!entity) return ctx.notFound('Enrollment record not found.');

  // Only the enrolled student or admin/content manager can cancel enrollment
  if (userRole === 'student' && entity.user?.id !== user.id) {
    return ctx.forbidden('You do not have permission to delete this enrollment.');
  }

  // 1. Delete the enrollment record
  await strapi.documents('api::enroll.enroll').delete({
    documentId: id,
  });

  // 2. Clean up any completed lesson progress records for this course
  if (entity.course?.documentId) {
    const userProgresses = await strapi.documents('api::progress.progress').findMany({
      filters: {
        user: { id: user.id },
        course: { documentId: entity.course.documentId },
      },
    });

    for (const p of userProgresses || []) {
      if (p.documentId) {
        await strapi.documents('api::progress.progress').delete({
          documentId: p.documentId,
        });
      }
    }
  }

  ctx.status = 200;
  return { success: true, message: 'Successfully unenrolled from course.' };
}
