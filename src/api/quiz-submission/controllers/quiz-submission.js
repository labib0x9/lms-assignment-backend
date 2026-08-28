'use strict';

/**
 * quiz-submission controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::quiz-submission.quiz-submission', ({ strapi }) => ({
  // GET /api/quiz-submissions
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to view quiz submissions.');

    const userRole = user.role?.type;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const queryFilters =
      typeof sanitizedQuery.filters === 'object' && sanitizedQuery.filters !== null
        ? sanitizedQuery.filters
        : {};

    let scopedFilters = { ...queryFilters };

    if (userRole === 'student') {
      scopedFilters = {
        ...scopedFilters,
        user: {
          id: user.id,
        },
      };
    } else if (userRole === 'instructor') {
      scopedFilters = {
        ...scopedFilters,
        quiz: {
          course: {
            Instructors: {
              id: user.id,
            },
          },
        },
      };
    }

    const results = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
      filters: scopedFilters,
      populate: {
        quiz: {
          fields: ['id', 'documentId', 'title'],
        },
        user: {
          fields: ['id', 'documentId', 'username', 'email'],
        },
      },
    });

    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedResults);
  },
}));
