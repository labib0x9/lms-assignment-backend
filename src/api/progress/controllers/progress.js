'use strict';

/**
 * progress controller (Per-Lesson Tracking with completed_at soft-toggle)
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::progress.progress', ({ strapi }) => ({
  // GET /api/progresses (Fetch all completed lesson progress for current student)
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to view progress.');

    const userRole = user.role?.type;
    if (userRole !== 'student') {
      return ctx.forbidden('Progress tracking is only available for students.');
    }

    // Fetch all student progress records where completed_at is not null
    const progressList = await strapi.documents('api::progress.progress').findMany({
      filters: {
        user: {
          id: user.id,
        },
        completed_at: {
          $notNull: true,
        },
      },
      populate: {
        course: {
          fields: ['id', 'documentId', 'title', 'price'],
          populate: {
            lessons: {
              fields: ['id', 'documentId', 'order'],
            },
          },
        },
        lesson: {
          fields: ['id', 'documentId', 'title', 'order'],
        },
      },
    });

    // Group progress by course
    const courseMap = new Map();

    for (const item of progressList || []) {
      const course = item.course;
      if (!course?.documentId) continue;

      if (!courseMap.has(course.documentId)) {
        const totalLessons = Array.isArray(course.lessons) ? course.lessons.length : 0;
        courseMap.set(course.documentId, {
          course: {
            id: course.id,
            documentId: course.documentId,
            title: course.title,
            price: course.price,
          },
          total_lessons: totalLessons,
          completed_lesson_ids: [],
          completed_count: 0,
        });
      }

      const entry = courseMap.get(course.documentId);
      const lessonDocId = item.lesson?.documentId;
      if (lessonDocId && !entry.completed_lesson_ids.includes(lessonDocId)) {
        entry.completed_lesson_ids.push(lessonDocId);
        entry.completed_count = entry.completed_lesson_ids.length;
      }
    }

    const formattedData = Array.from(courseMap.values()).map((entry) => ({
      course: entry.course,
      total_lessons: entry.total_lessons,
      completed_count: entry.completed_count,
      completed_lesson_ids: entry.completed_lesson_ids,
      percentage:
        entry.total_lessons > 0
          ? Math.round((entry.completed_count / entry.total_lessons) * 100)
          : 0,
    }));

    return this.transformResponse(formattedData);
  },

  // GET /api/progresses/course/:courseId (Fetch progress for a single course)
  async findByCourse(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to view progress.');

    const userRole = user.role?.type;
    if (userRole !== 'student') {
      return ctx.forbidden('Progress tracking is only available for students.');
    }

    const { courseId } = ctx.params;
    if (!courseId) return ctx.badRequest('Course identifier is required.');

    // Look up target course and its published lessons
    let course = await strapi.documents('api::course.course').findOne({
      documentId: courseId,
      populate: {
        lessons: {
          fields: ['id', 'documentId', 'title', 'order'],
          sort: 'order:asc',
        },
      },
    });

    if (!course) {
      const foundCourse = await strapi.db.query('api::course.course').findOne({
        where: { id: courseId },
        populate: ['lessons'],
      });
      course = foundCourse;
    }

    if (!course) return ctx.notFound('Course not found.');

    const totalLessons = Array.isArray(course.lessons) ? course.lessons.length : 0;

    // Fetch all active completed lessons for this student in this course (completed_at != null)
    const completedRecords = await strapi.documents('api::progress.progress').findMany({
      filters: {
        user: {
          id: user.id,
        },
        course: {
          documentId: course.documentId,
        },
        completed_at: {
          $notNull: true,
        },
      },
      populate: {
        lesson: {
          fields: ['id', 'documentId'],
        },
      },
    });

    const completedLessonIds = (completedRecords || [])
      .map((rec) => rec.lesson?.documentId)
      .filter(Boolean);

    const completedCount = completedLessonIds.length;
    const percentage =
      totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

    const formattedData = {
      course: {
        id: course.id,
        documentId: course.documentId,
        title: course.title,
        price: course.price,
      },
      total_lessons: totalLessons,
      completed_count: completedCount,
      completed_lesson_ids: completedLessonIds,
      percentage,
      is_fully_completed: totalLessons > 0 && completedCount >= totalLessons,
    };

    return this.transformResponse(formattedData);
  },

  // POST /api/progresses/toggle-lesson (Toggle completion: sets completed_at or null)
  async toggleLesson(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to update progress.');

    const userRole = user.role?.type;
    if (userRole !== 'student') {
      return ctx.forbidden('Progress tracking is only available for students.');
    }

    const body = ctx.request.body || {};
    const bodyData =
      body && typeof body === 'object' && typeof body.data === 'object' && body.data !== null
        ? body.data
        : {};

    const lessonParam =
      bodyData.lesson?.documentId || bodyData.lesson?.id || bodyData.lesson;

    if (!lessonParam) {
      return ctx.badRequest('Lesson identifier is required.');
    }

    // 1. Locate Lesson and its parent Course
    let lesson = null;
    if (typeof lessonParam === 'string') {
      lesson = await strapi.documents('api::lesson.lesson').findOne({
        documentId: lessonParam,
        populate: {
          course: {
            fields: ['id', 'documentId', 'title'],
            populate: {
              lessons: {
                fields: ['id', 'documentId', 'order'],
              },
            },
          },
        },
      });
    } else if (typeof lessonParam === 'number') {
      lesson = await strapi.db.query('api::lesson.lesson').findOne({
        where: { id: lessonParam },
        populate: {
          course: {
            populate: ['lessons'],
          },
        },
      });
    }

    if (!lesson || !lesson.course) {
      return ctx.notFound('Lesson or parent course not found.');
    }

    const course = lesson.course;
    const totalLessons = Array.isArray(course.lessons) ? course.lessons.length : 0;

    // 2. Resolve user's documentId
    let userDocId = user.documentId;
    if (!userDocId && user.id) {
      const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
      });
      userDocId = fullUser?.documentId || user.id;
    }

    // 3. Verify student enrollment in parent course
    const enrollment = await strapi.documents('api::enroll.enroll').findFirst({
      filters: {
        user: {
          id: user.id,
        },
        course: {
          documentId: course.documentId,
        },
      },
    });

    if (!enrollment) {
      return ctx.forbidden('You must be enrolled in this course to track progress.');
    }

    // 4. Check if a progress record exists for (user, lesson)
    const existingProgress = await strapi.documents('api::progress.progress').findFirst({
      filters: {
        user: {
          id: user.id,
        },
        lesson: {
          documentId: lesson.documentId,
        },
      },
    });

    let isCompletedNow = false;

    if (existingProgress) {
      if (existingProgress.completed_at) {
        // Unmark as completed: Update completed_at to null
        await strapi.documents('api::progress.progress').update({
          documentId: existingProgress.documentId,
          data: {
            completed_at: null,
          },
        });
        isCompletedNow = false;
      } else {
        // Re-mark as completed: Update completed_at to current timestamp
        await strapi.documents('api::progress.progress').update({
          documentId: existingProgress.documentId,
          data: {
            completed_at: new Date().toISOString(),
          },
        });
        isCompletedNow = true;
      }
    } else {
      // First insert: Create row with completed_at = current timestamp
      await strapi.documents('api::progress.progress').create({
        data: {
          user: userDocId,
          lesson: lesson.documentId,
          course: course.documentId,
          completed_at: new Date().toISOString(),
        },
      });
      isCompletedNow = true;
    }

    // 5. Fetch updated summary for the course (where completed_at != null)
    const allCompletedForCourse = await strapi.documents('api::progress.progress').findMany({
      filters: {
        user: {
          id: user.id,
        },
        course: {
          documentId: course.documentId,
        },
        completed_at: {
          $notNull: true,
        },
      },
      populate: {
        lesson: {
          fields: ['id', 'documentId'],
        },
      },
    });

    const updatedCompletedIds = (allCompletedForCourse || [])
      .map((rec) => rec.lesson?.documentId)
      .filter(Boolean);

    const completedCount = updatedCompletedIds.length;
    const percentage =
      totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

    const formattedData = {
      lesson_document_id: lesson.documentId,
      is_completed: isCompletedNow,
      course_document_id: course.documentId,
      total_lessons: totalLessons,
      completed_count: completedCount,
      completed_lesson_ids: updatedCompletedIds,
      percentage,
      is_fully_completed: totalLessons > 0 && completedCount >= totalLessons,
    };

    return this.transformResponse(formattedData);
  },
}));
