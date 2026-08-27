'use strict';

/**
 * lesson controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::lesson.lesson', ({ strapi }) => ({
  // GET /api/lessons
  async find(ctx) {
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const { results, pagination } = await strapi.service('api::lesson.lesson').find({
      ...(typeof sanitizedQuery === 'object' && sanitizedQuery !== null ? sanitizedQuery : {}),
      populate: {
        course: {
          fields: ['id', 'documentId', 'title', 'price'],
        },
      },
    });

    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedResults, { pagination });
  },

  // GET /api/lessons/:id
  async findOne(ctx) {
    const { id } = ctx.params;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const entity = await strapi.service('api::lesson.lesson').findOne(id, {
      ...(typeof sanitizedQuery === 'object' && sanitizedQuery !== null ? sanitizedQuery : {}),
      populate: {
        course: {
          fields: ['id', 'documentId', 'title', 'price'],
        },
      },
    });

    if (!entity) return ctx.notFound('Lesson not found');

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  // POST /api/lessons (Create lesson with auto-calculated order and auto-publish)
  async create(ctx) {
    const body = ctx.request.body || {};
    const bodyData =
      body && typeof body === 'object' && typeof body.data === 'object' && body.data !== null
        ? body.data
        : {};

    const courseParam = bodyData.course?.documentId || bodyData.course;

    // Resolve parent course documentId
    let courseDocId = null;
    if (courseParam) {
      if (typeof courseParam === 'string') {
        courseDocId = courseParam;
      } else if (typeof courseParam === 'number') {
        const foundCourse = await strapi.db.query('api::course.course').findOne({
          where: { id: courseParam },
        });
        courseDocId = foundCourse?.documentId;
      }
    }

    // Auto-calculate order if not provided
    let calculatedOrder = bodyData.order;
    if (calculatedOrder === undefined || calculatedOrder === null) {
      if (courseDocId) {
        const lastLessons = await strapi.documents('api::lesson.lesson').findMany({
          filters: {
            course: {
              documentId: courseDocId,
            },
          },
          sort: 'order:desc',
          limit: 1,
        });

        const highestOrder = lastLessons?.[0]?.order;
        calculatedOrder = typeof highestOrder === 'number' ? highestOrder + 1 : 1;
      } else {
        calculatedOrder = 1;
      }
    }

    const inputData = {
      ...bodyData,
      order: Number(calculatedOrder),
      ...(courseDocId
        ? {
            course: {
              connect: [courseDocId],
            },
          }
        : {}),
    };

    // Create and auto-publish lesson
    const entity = await strapi.documents('api::lesson.lesson').create({
      data: inputData,
      status: 'published',
      populate: {
        course: {
          fields: ['id', 'documentId', 'title'],
        },
      },
    });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    ctx.status = 201;
    return this.transformResponse(sanitizedEntity);
  },
}));
