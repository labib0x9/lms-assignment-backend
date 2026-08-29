'use strict';

/**
 * quiz controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::quiz.quiz', ({ strapi }) => ({
  // GET /api/quizzes
  // List quizzes - gated by enrollment for students
  async find(ctx) {
    return handleFind(this, ctx, strapi);
  },

  // GET /api/quizzes/:id
  /// View single quiz - answers hidden for students
  async findOne(ctx) {
    return handleFindOne(this, ctx, strapi);
  },

  // GET /api/quizzes/course/:courseId
  // Fetch quizzes by course
  async findByCourse(ctx) {
    return handleFindByCourse(this, ctx, strapi);
  },

  // POST /api/quizzes
  // Create Quiz - Course Owner or Admin
  async create(ctx) {
    return handleCreate(this, ctx, strapi);
  },

  // POST /api/quizzes/:id/submit
  // Auto-Grade Student Submission
  async submitQuiz(ctx) {
    return handleSubmitQuiz(this, ctx, strapi);
  },

  // GET /api/quizzes/:id/my-submission
  // Fetch latest submission for student
  async mySubmission(ctx) {
    return handleMySubmission(this, ctx, strapi);
  },
}));

// Students never see correct_answer in query responses; instructors and admins do.
function questionFields(userRole) {
  const base = ['id', 'documentId', 'question_text', 'options', 'points'];
  return userRole === 'student' ? base : [...base, 'correct_answer'];
}

// Course lookup by documentId or numeric database ID
async function findCourse(strapi, idOrDocId, populate) {
  let course = await strapi.documents('api::course.course').findOne({
    documentId: idOrDocId,
    populate,
  });
  if (!course) {
    course = await strapi.db.query('api::course.course').findOne({
      where: { id: idOrDocId },
      populate: Object.keys(populate || {}),
    });
  }
  return course;
}

// Check student enrollment in a course
async function isEnrolled(strapi, userId, courseDocumentId) {
  const enrollment = await strapi.documents('api::enroll.enroll').findFirst({
    filters: { user: { id: userId }, course: { documentId: courseDocumentId } },
  });
  return !!enrollment;
}

// Resolve user's documentId
async function resolveUserDocId(strapi, user) {
  if (user.documentId) return user.documentId;
  const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: user.id },
  });
  return fullUser?.documentId || user.id;
}

// Get All Quizzes
async function handleFind(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to view quizzes.');
  const userRole = user.role?.type;

  await controller.validateQuery(ctx);
  const sanitizedQuery = await controller.sanitizeQuery(ctx);
  const queryFilters =
    typeof sanitizedQuery.filters === 'object' && sanitizedQuery.filters !== null
      ? sanitizedQuery.filters
      : {};

  let scopedFilters = { ...queryFilters };

  if (userRole === 'student') {
    const enrollments = await strapi.documents('api::enroll.enroll').findMany({
      filters: { user: { id: user.id } },
      populate: { course: { fields: ['id', 'documentId'] } },
    });
    const enrolledCourseDocIds = (enrollments || []).map((e) => e.course?.documentId).filter(Boolean);
    scopedFilters = { ...scopedFilters, course: { documentId: { $in: enrolledCourseDocIds } } };
  } else if (userRole === 'instructor') {
    scopedFilters = { ...scopedFilters, course: { Instructors: { id: user.id } } };
  }

  const results = await strapi.documents('api::quiz.quiz').findMany({
    filters: scopedFilters,
    populate: {
      course: { fields: ['id', 'documentId', 'title', 'price'] },
      questions: { fields: questionFields(userRole) },
    },
  });

  const sanitizedResults = await controller.sanitizeOutput(results, ctx);
  return controller.transformResponse(sanitizedResults);
}

// Single quiz
async function handleFindOne(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to view the quiz.');
  const userRole = user.role?.type;
  const { id } = ctx.params;

  await controller.validateQuery(ctx);
  const sanitizedQuery = await controller.sanitizeQuery(ctx);

  const entity = await strapi.documents('api::quiz.quiz').findOne({
    documentId: id,
    ...(typeof sanitizedQuery === 'object' && sanitizedQuery !== null ? sanitizedQuery : {}),
    populate: {
      course: {
        fields: ['id', 'documentId', 'title'],
        populate: { Instructors: { fields: ['id', 'documentId'] } },
      },
      questions: { fields: questionFields(userRole) },
    },
  });
  if (!entity) return ctx.notFound('Quiz not found.');

  if (userRole === 'student') {
    const enrolled = await isEnrolled(strapi, user.id, entity.course?.documentId);
    if (!enrolled) return ctx.forbidden('You must be enrolled in this course to access this quiz.');
  }

  const sanitizedEntity = await controller.sanitizeOutput(entity, ctx);
  return controller.transformResponse(sanitizedEntity);
}

// Fetch quizzes by course
async function handleFindByCourse(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to access quizzes.');
  const userRole = user.role?.type;
  const { courseId } = ctx.params;

  const course = await findCourse(strapi, courseId, { Instructors: { fields: ['id', 'documentId'] } });
  if (!course) return ctx.notFound('Course not found.');

  if (userRole === 'student') {
    const enrolled = await isEnrolled(strapi, user.id, course.documentId);
    if (!enrolled) return ctx.forbidden('You must be enrolled in this course to access quizzes.');
  }

  const quizzes = await strapi.documents('api::quiz.quiz').findMany({
    filters: { course: { documentId: course.documentId } },
    populate: { questions: { fields: questionFields(userRole) } },
  });

  const sanitizedResults = await controller.sanitizeOutput(quizzes, ctx);
  return controller.transformResponse(sanitizedResults);
}

// create course
async function handleCreate(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to create a quiz.');
  const userRole = user.role?.type;
  // if (userRole === 'student') return ctx.forbidden('Students cannot create quizzes.');

  const body = ctx.request.body || {};
  const bodyData = body?.data && typeof body.data === 'object' ? body.data : {};
  const courseParam = bodyData.course?.documentId || bodyData.course?.id || bodyData.course;
  if (!courseParam) return ctx.badRequest('A course relation is required to create a quiz.');

  const course = await findCourse(strapi, courseParam, { Instructors: true });
  if (!course) return ctx.notFound('Parent course not found.');

  if (userRole === 'instructor') {
    const isOwner = course.Instructors?.some(
      (inst) => inst.id === user.id || (user.documentId && inst.documentId === user.documentId)
    );
    if (!isOwner) return ctx.forbidden('You can only create quizzes for your own courses.');
  }

  const entity = await strapi.documents('api::quiz.quiz').create({
    data: { title: bodyData.title, course: course.documentId },
    populate: { course: { fields: ['id', 'documentId', 'title'] } },
  });

  const sanitizedEntity = await controller.sanitizeOutput(entity, ctx);
  ctx.status = 201;
  return controller.transformResponse(sanitizedEntity);
}

// submission handling and grading against corret answer
async function handleSubmitQuiz(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to submit a quiz.');
  if (user.role?.type !== 'student') return ctx.forbidden('Only enrolled students can submit quizzes.');

  const { id } = ctx.params;
  const body = ctx.request.body || {};
  const bodyData = body?.data && typeof body.data === 'object' ? body.data : {};

  const quiz = await strapi.documents('api::quiz.quiz').findOne({
    documentId: id,
    populate: {
      course: { fields: ['id', 'documentId', 'title'] },
      questions: { fields: ['id', 'documentId', 'question_text', 'options', 'correct_answer', 'points'] },
    },
  });
  if (!quiz) return ctx.notFound('Quiz not found.');

  const enrolled = await isEnrolled(strapi, user.id, quiz.course?.documentId);
  if (!enrolled) return ctx.forbidden('You must be enrolled in this course to submit this quiz.');

  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  if (questions.length === 0) return ctx.badRequest('This quiz has no questions.');

  const submittedAnswers = Array.isArray(bodyData.answers) ? bodyData.answers : [];
  const answersMap = new Map(
    submittedAnswers
      .filter((ans) => ans.question_id !== undefined && ans.question_id !== null)
      .map((ans) => [String(ans.question_id), ans.selected_answer])
  );

  let earnedScore = 0;
  let totalScore = 0;
  const detailedAnswers = [];

  for (const q of questions) {
    const qPoints = Number(q.points);
    totalScore += qPoints;

    const userChoice = answersMap.get(String(q.documentId));
    const correctIndex = Number(q.correct_answer);
    const isMatch = userChoice !== undefined && Number(userChoice) === correctIndex;

    if (isMatch) earnedScore += qPoints;

    detailedAnswers.push({
      question_id: q.documentId,
      question_text: q.question_text,
      options: q.options,
      selected_answer: userChoice !== undefined ? Number(userChoice) : null,
      correct_answer: correctIndex,
      is_correct: isMatch,
      points_awarded: isMatch ? qPoints : 0,
      points_possible: qPoints,
    });
  }

  const userDocId = await resolveUserDocId(strapi, user);

  const existing = await strapi.documents('api::quiz-submission.quiz-submission').findFirst({
    filters: { user: { id: user.id }, quiz: { documentId: quiz.documentId } },
  });

  let submission;
  if (existing) {
    submission = await strapi.documents('api::quiz-submission.quiz-submission').update({
      documentId: existing.documentId,
      data: { score: earnedScore, total_score: totalScore, answers: detailedAnswers, submitted_at: new Date().toISOString() },
    });
    ctx.status = 200;
  } else {
    submission = await strapi.documents('api::quiz-submission.quiz-submission').create({
      data: { user: userDocId, quiz: quiz.documentId, score: earnedScore, total_score: totalScore, answers: detailedAnswers, submitted_at: new Date().toISOString() },
    });
    ctx.status = 201;
  }

  return controller.transformResponse({
    submission_id: submission.documentId,
    score: earnedScore,
    total_score: totalScore,
    percentage: totalScore > 0 ? Math.round((earnedScore / totalScore) * 100) : 0,
    answers: detailedAnswers,
    submitted_at: submission.submitted_at,
  });
}

// last submission
async function handleMySubmission(controller, ctx, strapi) {
  const user = ctx.state.user;
  if (!user) return ctx.unauthorized('You must be logged in to view submission results.');

  const { id } = ctx.params;
  const latestSubmission = await strapi.documents('api::quiz-submission.quiz-submission').findFirst({
    filters: { user: { id: user.id }, quiz: { documentId: id } },
    sort: 'submitted_at:desc',
  });
  if (!latestSubmission) return controller.transformResponse(null);

  return controller.transformResponse({
    submission_id: latestSubmission.documentId,
    score: latestSubmission.score,
    total_score: latestSubmission.total_score,
    percentage:
      latestSubmission.total_score > 0
        ? Math.round((latestSubmission.score / latestSubmission.total_score) * 100)
        : 0,
    answers: latestSubmission.answers || [],
    submitted_at: latestSubmission.submitted_at,
  });
}


