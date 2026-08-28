'use strict';

/**
 * quiz controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::quiz.quiz', ({ strapi }) => ({
  // GET /api/quizzes (List quizzes - gated by enrollment for students)
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to view quizzes.');

    const userRole = user.role?.type;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const queryFilters =
      typeof sanitizedQuery.filters === 'object' && sanitizedQuery.filters !== null
        ? sanitizedQuery.filters
        : {};

    let scopedFilters = { ...queryFilters };

    if (userRole === 'student') {
      // Find all enrolled course documentIds for this student
      const enrollments = await strapi.documents('api::enroll.enroll').findMany({
        filters: {
          user: {
            id: user.id,
          },
        },
        populate: {
          course: {
            fields: ['id', 'documentId'],
          },
        },
      });

      const enrolledCourseDocIds = (enrollments || [])
        .map((e) => e.course?.documentId)
        .filter(Boolean);

      scopedFilters = {
        ...scopedFilters,
        course: {
          documentId: {
            $in: enrolledCourseDocIds,
          },
        },
      };
    } else if (userRole === 'instructor') {
      scopedFilters = {
        ...scopedFilters,
        course: {
          Instructors: {
            id: user.id,
          },
        },
      };
    }

    const results = await strapi.documents('api::quiz.quiz').findMany({
      filters: scopedFilters,
      populate: {
        course: {
          fields: ['id', 'documentId', 'title', 'price'],
        },
        questions: {
          fields:
            userRole === 'student'
              ? ['id', 'documentId', 'question_text', 'options', 'points']
              : ['id', 'documentId', 'question_text', 'options', 'correct_answer', 'points'],
        },
      },
    });

    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedResults);
  },

  // GET /api/quizzes/:id (View single quiz - answer hidden for students)
  async findOne(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to view the quiz.');

    const { id } = ctx.params;
    const userRole = user.role?.type;

    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const entity = await strapi.documents('api::quiz.quiz').findOne({
      documentId: id,
      ...(typeof sanitizedQuery === 'object' && sanitizedQuery !== null ? sanitizedQuery : {}),
      populate: {
        course: {
          fields: ['id', 'documentId', 'title'],
          populate: {
            Instructors: {
              fields: ['id', 'documentId'],
            },
          },
        },
        questions: {
          fields:
            userRole === 'student'
              ? ['id', 'documentId', 'question_text', 'options', 'points']
              : ['id', 'documentId', 'question_text', 'options', 'correct_answer', 'points'],
        },
      },
    });

    if (!entity) return ctx.notFound('Quiz not found.');

    const course = entity.course;

    // Verify enrollment for students
    if (userRole === 'student') {
      const enrollment = await strapi.documents('api::enroll.enroll').findFirst({
        filters: {
          user: { id: user.id },
          course: { documentId: course?.documentId },
        },
      });

      if (!enrollment) {
        return ctx.forbidden('You must be enrolled in this course to access this quiz.');
      }
    }

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  // GET /api/quizzes/course/:courseId (Fetch quizzes for an enrolled course)
  async findByCourse(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to access quizzes.');

    const { courseId } = ctx.params;
    const userRole = user.role?.type;

    // Locate Course
    let course = await strapi.documents('api::course.course').findOne({
      documentId: courseId,
      populate: {
        Instructors: {
          fields: ['id', 'documentId'],
        },
      },
    });

    if (!course) {
      course = await strapi.db.query('api::course.course').findOne({
        where: { id: courseId },
        populate: ['Instructors'],
      });
    }

    if (!course) return ctx.notFound('Course not found.');

    // Check student enrollment
    if (userRole === 'student') {
      const enrollment = await strapi.documents('api::enroll.enroll').findFirst({
        filters: {
          user: { id: user.id },
          course: { documentId: course.documentId },
        },
      });

      if (!enrollment) {
        return ctx.forbidden('You must be enrolled in this course to access quizzes.');
      }
    }

    const quizzes = await strapi.documents('api::quiz.quiz').findMany({
      filters: {
        course: {
          documentId: course.documentId,
        },
      },
      populate: {
        questions: {
          fields:
            userRole === 'student'
              ? ['id', 'documentId', 'question_text', 'options', 'points']
              : ['id', 'documentId', 'question_text', 'options', 'correct_answer', 'points'],
        },
      },
    });

    const sanitizedResults = await this.sanitizeOutput(quizzes, ctx);
    return this.transformResponse(sanitizedResults);
  },

  // POST /api/quizzes (Create Quiz - Course Owner or Admin)
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to create a quiz.');

    const userRole = user.role?.type;
    if (userRole === 'student') {
      return ctx.forbidden('Students cannot create quizzes.');
    }

    const body = ctx.request.body || {};
    const bodyData =
      body && typeof body === 'object' && typeof body.data === 'object' && body.data !== null
        ? body.data
        : {};

    const courseParam =
      bodyData.course?.documentId || bodyData.course?.id || bodyData.course;

    if (!courseParam) {
      return ctx.badRequest('A course relation is required to create a quiz.');
    }

    let course = await strapi.documents('api::course.course').findOne({
      documentId: courseParam,
      populate: ['Instructors'],
    });

    if (!course) {
      course = await strapi.db.query('api::course.course').findOne({
        where: { id: courseParam },
        populate: ['Instructors'],
      });
    }

    if (!course) return ctx.notFound('Parent course not found.');

    // Check ownership if instructor
    if (userRole === 'instructor') {
      const isOwner = course.Instructors?.some(
        (inst) =>
          inst.id === user.id ||
          (user.documentId && inst.documentId === user.documentId)
      );
      if (!isOwner) {
        return ctx.forbidden('You can only create quizzes for your own courses.');
      }
    }

    const entity = await strapi.documents('api::quiz.quiz').create({
      data: {
        title: bodyData.title,
        course: course.documentId,
      },
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

  // POST /api/quizzes/:id/submit (Auto-Grade Student Submission)
  async submitQuiz(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to submit a quiz.');

    const userRole = user.role?.type;
    if (userRole !== 'student') {
      return ctx.forbidden('Only enrolled students can submit quizzes.');
    }

    const { id } = ctx.params;
    const body = ctx.request.body || {};
    const bodyData =
      body && typeof body === 'object' && typeof body.data === 'object' && body.data !== null
        ? body.data
        : {};

    // 1. Fetch Quiz with its full Questions list (including correct_answer)
    const quiz = await strapi.documents('api::quiz.quiz').findOne({
      documentId: id,
      populate: {
        course: {
          fields: ['id', 'documentId', 'title'],
        },
        questions: {
          fields: ['id', 'documentId', 'question_text', 'options', 'correct_answer', 'points'],
        },
      },
    });

    if (!quiz) return ctx.notFound('Quiz not found.');

    // 2. Verify student enrollment in course
    const enrollment = await strapi.documents('api::enroll.enroll').findFirst({
      filters: {
        user: { id: user.id },
        course: { documentId: quiz.course?.documentId },
      },
    });

    if (!enrollment) {
      return ctx.forbidden('You must be enrolled in this course to submit this quiz.');
    }

    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    if (questions.length === 0) {
      return ctx.badRequest('This quiz has no questions.');
    }

    // 3. Auto-Grading Calculation
    const submittedAnswers = Array.isArray(bodyData.answers) ? bodyData.answers : [];
    const answersMap = new Map();

    submittedAnswers.forEach((ans) => {
      const qKey = String(ans.question_id || ans.questionDocumentId || ans.id || '');
      const selected = String(ans.selected_answer || ans.answer || '').trim();
      if (qKey) answersMap.set(qKey, selected);
    });

    let earnedScore = 0;
    let maxScore = 0;

    for (const q of questions) {
      const qPoints = Number(q.points || 1);
      maxScore += qPoints;

      const userChoice =
        answersMap.get(String(q.documentId)) ||
        answersMap.get(String(q.id)) ||
        '';

      const correctAnswer = String(q.correct_answer || '').trim();

      if (userChoice && userChoice.toLowerCase() === correctAnswer.toLowerCase()) {
        earnedScore += qPoints;
      }
    }

    let userDocId = user.documentId;
    if (!userDocId && user.id) {
      const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
      });
      userDocId = fullUser?.documentId || user.id;
    }

    // 4. Record QuizSubmission in database
    const submission = await strapi.documents('api::quiz-submission.quiz-submission').create({
      data: {
        user: userDocId,
        quiz: quiz.documentId,
        score: earnedScore,
        total_score: maxScore,
        submitted_at: new Date().toISOString(),
      },
    });

    const percentage = maxScore > 0 ? Math.round((earnedScore / maxScore) * 100) : 0;

    const result = {
      submission_id: submission.documentId,
      score: earnedScore,
      total_score: maxScore,
      percentage,
      submitted_at: submission.submitted_at,
    };

    ctx.status = 201;
    return this.transformResponse(result);
  },

  // GET /api/quizzes/:id/my-submission (Fetch latest submission for student)
  async mySubmission(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in to view submission results.');

    const { id } = ctx.params;

    const latestSubmission = await strapi.documents('api::quiz-submission.quiz-submission').findFirst({
      filters: {
        user: { id: user.id },
        quiz: { documentId: id },
      },
      sort: 'submitted_at:desc',
    });

    if (!latestSubmission) {
      return this.transformResponse(null);
    }

    const percentage =
      latestSubmission.total_score > 0
        ? Math.round((latestSubmission.score / latestSubmission.total_score) * 100)
        : 0;

    return this.transformResponse({
      submission_id: latestSubmission.documentId,
      score: latestSubmission.score,
      total_score: latestSubmission.total_score,
      percentage,
      submitted_at: latestSubmission.submitted_at,
    });
  },
}));
