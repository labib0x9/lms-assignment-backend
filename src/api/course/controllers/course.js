'use strict';

/**
 * course controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::course.course', ({ strapi }) => ({
  // GET /api/courses
  async find(ctx) {
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const { results, pagination } = await strapi.service('api::course.course').find({
      ...(typeof sanitizedQuery === 'object' && sanitizedQuery !== null ? sanitizedQuery : {}),
      populate: {
        Instructors: {
          fields: ['id', 'username', 'email', 'documentId'],
        },
        thumbnail: true,
        lessons: {
          sort: 'order:asc',
        },
      },
    });

    const sanitizedResults = await this.sanitizeOutput(results, ctx);

    // Ensure public instructor info is retained in the response
    const formattedData = (results || []).map((course, index) => {
      const sanitized = Array.isArray(sanitizedResults)
        ? sanitizedResults[index]
        : sanitizedResults;

      const sanitizedObj =
        typeof sanitized === 'object' && sanitized !== null ? sanitized : {};

      return {
        ...sanitizedObj,
        Instructors: (course.Instructors || []).map((inst) => ({
          id: inst.id,
          documentId: inst.documentId,
          username: inst.username,
          email: inst.email,
        })),
        lessons: course.lessons || [],
      };
    });

    return this.transformResponse(formattedData, { pagination });
  },

  // GET /api/courses/:id
  async findOne(ctx) {
    const { id } = ctx.params;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    // Support both documentId (string) and legacy database id (number)
    const entity = await strapi.documents('api::course.course').findOne({
      documentId: id,
      ...(typeof sanitizedQuery === 'object' && sanitizedQuery !== null ? sanitizedQuery : {}),
      populate: {
        Instructors: {
          fields: ['id', 'username', 'email', 'documentId'],
        },
        thumbnail: true,
        lessons: {
          sort: 'order:asc',
        },
      },
    });

    if (!entity) return ctx.notFound('Course not found');

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    const sanitizedObj =
      typeof sanitizedEntity === 'object' && sanitizedEntity !== null
        ? sanitizedEntity
        : {};

    const formattedData = {
      ...sanitizedObj,
      Instructors: (entity.Instructors || []).map((inst) => ({
        id: inst.id,
        documentId: inst.documentId,
        username: inst.username,
        email: inst.email,
      })),
      lessons: entity.lessons || [],
    };

    return this.transformResponse(formattedData);
  },

  // POST /api/courses (Create course and attach instructor)
  async create(ctx) {
    const user = ctx.state.user;
    const userRole = user?.role?.type;

    let userDocId = user?.documentId;
    if (!userDocId && user?.id) {
      const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
      });
      userDocId = fullUser?.documentId || user.id;
    }

    const body = ctx.request.body || {};
    const bodyData =
      body && typeof body === 'object' && typeof body.data === 'object' && body.data !== null
        ? body.data
        : {};

    const inputData = {
      ...bodyData,
      ...(userRole === 'instructor' && userDocId ? { Instructors: [userDocId] } : {}),
    };

    // Create and auto-publish so it immediately appears in the course list
    const entity = await strapi.documents('api::course.course').create({
      data: inputData,
      status: 'published',
      populate: {
        Instructors: {
          fields: ['id', 'username', 'email', 'documentId'],
        },
        thumbnail: true,
        lessons: {
          sort: 'order:asc',
        },
      },
    });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    const sanitizedObj =
      typeof sanitizedEntity === 'object' && sanitizedEntity !== null
        ? sanitizedEntity
        : {};

    const result = {
      ...sanitizedObj,
      Instructors: (entity.Instructors || []).map((inst) => ({
        id: inst.id,
        documentId: inst.documentId,
        username: inst.username,
        email: inst.email,
      })),
      lessons: entity.lessons || [],
    };

    ctx.status = 201;
    return this.transformResponse(result);
  },
}));
