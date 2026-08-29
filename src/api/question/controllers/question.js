'use strict';

/**
 * question controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::question.question', ({ strapi }) => ({
  // POST /api/questions (Instructor creates a question inside a quiz)
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to add questions.');

    const userRole = user.role?.type;
    if (userRole === 'student') {
      return ctx.forbidden('Students cannot create quiz questions.');
    }

    const body = ctx.request.body || {};
    const bodyData =
      body && typeof body === 'object' && typeof body.data === 'object' && body.data !== null
        ? body.data
        : {};

    const quizParam =
      bodyData.quiz?.documentId || bodyData.quiz?.id || bodyData.quiz;

    if (!quizParam) {
      return ctx.badRequest('A quiz relation is required to create a question.');
    }

    // Locate Quiz and Course
    let quiz = await strapi.documents('api::quiz.quiz').findOne({
      documentId: quizParam,
      populate: {
        course: {
          populate: ['Instructors'],
        },
      },
    });

    if (!quiz) {
      quiz = await strapi.db.query('api::quiz.quiz').findOne({
        where: { id: quizParam },
        populate: {
          course: {
            populate: ['Instructors'],
          },
        },
      });
    }

    if (!quiz || !quiz.course) {
      return ctx.notFound('Parent quiz or course not found.');
    }

    // Check instructor ownership
    if (userRole === 'instructor') {
      const isOwner = quiz.course.Instructors?.some(
        (inst) =>
          inst.id === user.id ||
          (user.documentId && inst.documentId === user.documentId)
      );
      if (!isOwner) {
        return ctx.forbidden('You can only add questions to quizzes in your own courses.');
      }
    }

    const entity = await strapi.documents('api::question.question').create({
      data: {
        question_text: bodyData.question_text,
        options: bodyData.options,
        correct_answer: Number(bodyData.correct_answer),
        points: bodyData.points !== undefined ? Number(bodyData.points) : 1,
        quiz: quiz.documentId,
      },
    });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    ctx.status = 201;
    return this.transformResponse(sanitizedEntity);
  },
}));
