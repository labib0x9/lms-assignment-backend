'use strict';

/**
 * enroll controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::enroll.enroll', ({ strapi }) => ({
  // GET /api/enrolls
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to view enrollments.');

    const userRole = user.role?.type;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const queryFilters =
      typeof sanitizedQuery.filters === 'object' && sanitizedQuery.filters !== null
        ? sanitizedQuery.filters
        : {};

    // 1. Role-based scoping
    let scopedFilters = { ...queryFilters };

    if (userRole === 'student') {
      // Students can only view their own enrollments
      scopedFilters = {
        ...scopedFilters,
        user: {
          id: user.id,
        },
      };
    } else if (userRole === 'instructor') {
      // Instructors can only view enrollments for courses they teach
      scopedFilters = {
        ...scopedFilters,
        course: {
          Instructors: {
            id: user.id,
          },
        },
      };
    }
    // Admins and Content Managers can view all enrollments

    const results = await strapi.documents('api::enroll.enroll').findMany({
      filters: scopedFilters,
      populate: {
        course: {
          fields: ['id', 'documentId', 'title', 'price', 'description'],
        },
        user: {
          fields: ['id', 'documentId', 'username', 'email'],
        },
      },
    });

    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    const formattedData = (results || []).map((enroll, index) => {
      const sanitized = Array.isArray(sanitizedResults)
        ? sanitizedResults[index]
        : sanitizedResults;

      const sanitizedObj =
        typeof sanitized === 'object' && sanitized !== null ? sanitized : {};

      const enrollObj = typeof enroll === 'object' && enroll !== null ? enroll : {};
      const course = enrollObj['course'];
      const student = enrollObj['user'];

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
    });

    return this.transformResponse(formattedData);
  },

  // GET /api/enrolls/:id
  async findOne(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to view enrollment details.');

    const { id } = ctx.params;
    const userRole = user.role?.type;

    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const entity = await strapi.documents('api::enroll.enroll').findOne({
      documentId: id,
      ...(typeof sanitizedQuery === 'object' && sanitizedQuery !== null ? sanitizedQuery : {}),
      populate: {
        course: {
          fields: ['id', 'documentId', 'title', 'price', 'description'],
        },
        user: {
          fields: ['id', 'documentId', 'username', 'email'],
        },
      },
    });

    if (!entity) return ctx.notFound('Enrollment record not found.');

    const entityObj = typeof entity === 'object' && entity !== null ? entity : {};
    const student = entityObj['user'];
    const course = entityObj['course'];

    // Enforce ownership: Students can only view their own enrollment
    if (userRole === 'student' && student?.id !== user.id) {
      return ctx.forbidden('You do not have permission to view this enrollment.');
    }

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    const sanitizedObj =
      typeof sanitizedEntity === 'object' && sanitizedEntity !== null
        ? sanitizedEntity
        : {};

    const formattedData = {
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

    return this.transformResponse(formattedData);
  },

  // POST /api/enrolls (Student Enroll Action)
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to enroll in a course.');

    const body = ctx.request.body || {};
    const bodyData =
      body && typeof body === 'object' && typeof body.data === 'object' && body.data !== null
        ? body.data
        : {};

    const courseParam = bodyData.course?.documentId || bodyData.course?.id || bodyData.course;
    if (!courseParam) {
      return ctx.badRequest('Please provide a valid course identifier to enroll.');
    }

    // 1. Locate target course
    let targetCourse = null;
    if (typeof courseParam === 'string') {
      targetCourse = await strapi.documents('api::course.course').findOne({
        documentId: courseParam,
      });
    } else if (typeof courseParam === 'number') {
      targetCourse = await strapi.db.query('api::course.course').findOne({
        where: { id: courseParam },
      });
    }

    if (!targetCourse) {
      return ctx.notFound('The selected course was not found.');
    }

    // 2. Resolve user's documentId
    let userDocId = user.documentId;
    if (!userDocId && user.id) {
      const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
      });
      userDocId = fullUser?.documentId || user.id;
    }

    // 3. Duplicate Enrollment Check
    const existingEnrollment = await strapi.documents('api::enroll.enroll').findFirst({
      filters: {
        user: {
          id: user.id,
        },
        course: {
          documentId: targetCourse.documentId,
        },
      },
    });

    if (existingEnrollment) {
      return ctx.badRequest('You are already enrolled in this course.');
    }

    // 4. Create Enrollment Record
    const entity = await strapi.documents('api::enroll.enroll').create({
      data: {
        user: userDocId,
        course: targetCourse.documentId,
        enrolled_at: new Date().toISOString(),
      },
      populate: {
        course: {
          fields: ['id', 'documentId', 'title', 'price', 'description'],
        },
        user: {
          fields: ['id', 'documentId', 'username', 'email'],
        },
      },
    });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    const sanitizedObj =
      typeof sanitizedEntity === 'object' && sanitizedEntity !== null
        ? sanitizedEntity
        : {};

    const entityObj = typeof entity === 'object' && entity !== null ? entity : {};
    const student = entityObj['user'];
    const course = entityObj['course'];

    const formattedData = {
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

    ctx.status = 201;
    return this.transformResponse(formattedData);
  },

  // DELETE /api/enrolls/:id (Unenroll)
  async delete(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to unenroll.');

    const { id } = ctx.params;
    const userRole = user.role?.type;

    const entity = await strapi.documents('api::enroll.enroll').findOne({
      documentId: id,
      populate: {
        user: {
          fields: ['id', 'documentId'],
        },
        course: {
          fields: ['id', 'documentId'],
        },
      },
    });

    if (!entity) return ctx.notFound('Enrollment record not found.');

    const entityObj = typeof entity === 'object' && entity !== null ? entity : {};
    const student = entityObj['user'];
    const course = entityObj['course'];

    // Only the enrolled student or admin/content manager can cancel enrollment
    if (userRole === 'student' && student?.id !== user.id) {
      return ctx.forbidden('You do not have permission to delete this enrollment.');
    }

    // 1. Delete the enrollment record
    await strapi.documents('api::enroll.enroll').delete({
      documentId: id,
    });

    // 2. Clean up any completed lesson progress records for this course
    if (course?.documentId) {
      const userProgresses = await strapi.documents('api::progress.progress').findMany({
        filters: {
          user: {
            id: user.id,
          },
          course: {
            documentId: course.documentId,
          },
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
  },
}));
