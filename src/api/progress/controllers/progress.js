'use strict';

/**
 * progress controller (Per-Lesson Tracking with completed_at soft-toggle)
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::progress.progress', ({ strapi }) => ({
  // GET /api/progresses
  // All completed progress for the logged-in student, grouped by course,
  // each with { completed_count, completed_lesson_ids, percentage, is_fully_completed }.
  async find(ctx) {
    return findAll(this, ctx, strapi)
  },

  // GET /api/progresses/course/:courseId
  // Completion summary for one course for the logged-in student.
  async findByCourse(ctx) {
    return findByCourse(this, ctx, strapi)
  },

  // POST /api/progresses/toggle-lesson
  // Body: { data: { lesson: <documentId | id> } }
  // Flips completed_at (null <-> now) for (user, lesson); creates the row on first toggle.
  // Requires enrollment in the lesson's parent course. Returns updated course summary.
  async toggleLesson(ctx) {
    return toggleLesson(this, ctx, strapi)
  },
}));

// checks if request type is a student
function requireStudent(ctx) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to view progress.');
  if (user.role?.type !== 'student') {
    return ctx.forbidden('Progress tracking is only available for students.');
  }
  return null;
}

// response format
function buildSummary(completedLessonIds, totalLessons) {
  const completedCount = completedLessonIds.length;
  return {
    total_lessons: totalLessons,
    completed_count: completedCount,
    completed_lesson_ids: completedLessonIds,
    // percentage: totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0,
    is_fully_completed: totalLessons > 0 && completedCount >= totalLessons,
  };
}

// Fetch this user's completed (completed_at != null) progress rows for one course.
async function getCompletedLessonIds(strapi, userId, courseDocumentId) {
  const records = await strapi.documents('api::progress.progress').findMany({
    filters: {
      user: { id: userId },
      course: { documentId: courseDocumentId },
      completed_at: { $notNull: true },
    },
    populate: { lesson: { fields: ['id', 'documentId'] } },
  });
  return (records || []).map((r) => r.lesson?.documentId).filter(Boolean);
}

// all course progress
async function findAll(controller, ctx, strapi) {
  const denied = requireStudent(ctx);
  if (denied) return denied;
  const user = ctx.state.user;

  const enrollments = await strapi.documents('api::enroll.enroll').findMany({
    filters: {
      user: { id: user.id },
    },
    populate: {
      course: {
        fields: ['id', 'documentId', 'title', 'price'],
        populate: {
          lessons: { fields: ['id', 'documentId', 'order'] },
        },
      },
    },
  });

  const results = await Promise.all(
    (enrollments || []).map(async (enrollment) => {
      const course = enrollment.course;
      if (!course) return null;

      const totalLessons = Array.isArray(course.lessons) ? course.lessons.length : 0;
      const completedLessonIds = await getCompletedLessonIds(strapi, user.id, course.documentId);

      return {
        course: {
          id: course.id,
          documentId: course.documentId,
          title: course.title,
          price: course.price,
        },
        ...buildSummary(completedLessonIds, totalLessons),
      };
    })
  );

  const formattedData = results.filter(Boolean);
  return controller.transformResponse(formattedData);
}

// single course progress
async function findByCourse(controller, ctx, strapi) {
  const denied = requireStudent(ctx);
  if (denied) return denied;
  const user = ctx.state.user;

  const { courseId } = ctx.params;
  if (!courseId) return ctx.badRequest('Course identifier is required.');

  const course = await strapi.documents('api::course.course').findOne({
    documentId: courseId,
    populate: { lessons: { fields: ['id', 'documentId', 'title', 'order'], sort: 'order:asc' } },
  });
  if (!course) return ctx.notFound('Course not found.');

  const totalLessons = Array.isArray(course.lessons) ? course.lessons.length : 0;
  const completedLessonIds = await getCompletedLessonIds(strapi, user.id, course.documentId);

  return controller.transformResponse({
    course: { id: course.id, documentId: course.documentId, title: course.title, price: course.price },
    ...buildSummary(completedLessonIds, totalLessons),
  });
}

// unmark a completed lesson or mark as completed
async function toggleLesson(controller, ctx, strapi) {
  const denied = requireStudent(ctx);
  if (denied) return denied;
  const user = ctx.state.user;

  const body = ctx.request.body || {};
  const bodyData = body?.data && typeof body.data === 'object' ? body.data : {};
  const lessonParam = bodyData.lesson;
  if (!lessonParam) return ctx.badRequest('Lesson identifier is required.');

  const lesson = await strapi.documents('api::lesson.lesson').findOne({
    documentId: String(lessonParam),
    populate: {
      course: {
        fields: ['id', 'documentId', 'title'],
        populate: { lessons: { fields: ['id', 'documentId', 'order'] } },
      },
    },
  });
  if (!lesson || !lesson.course) return ctx.notFound('Lesson or parent course not found.');

  const course = lesson.course;
  const totalLessons = Array.isArray(course.lessons) ? course.lessons.length : 0;

  const enrollment = await strapi.documents('api::enroll.enroll').findFirst({
    filters: { user: { id: user.id }, course: { documentId: course.documentId } },
  });
  if (!enrollment) return ctx.forbidden('You must be enrolled in this course to track progress.');

  const existingProgress = await strapi.documents('api::progress.progress').findFirst({
    filters: { user: { id: user.id }, lesson: { documentId: lesson.documentId } },
  });

  let isCompletedNow;
  if (existingProgress) {
    isCompletedNow = !existingProgress.completed_at;
    await strapi.documents('api::progress.progress').update({
      documentId: existingProgress.documentId,
      data: { completed_at: isCompletedNow ? new Date().toISOString() : null },
    });
  } else {
    await strapi.documents('api::progress.progress').create({
      data: {
        user: user.documentId,
        lesson: lesson.documentId,
        course: course.documentId,
        completed_at: new Date().toISOString(),
      },
    });
    isCompletedNow = true;
  }

  const updatedCompletedIds = await getCompletedLessonIds(strapi, user.id, course.documentId);

  return controller.transformResponse({
    lesson_document_id: lesson.documentId,
    is_completed: isCompletedNow,
    course_document_id: course.documentId,
    ...buildSummary(updatedCompletedIds, totalLessons),
  });
}