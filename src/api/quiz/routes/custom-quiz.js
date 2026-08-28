'use strict';

/**
 * Custom Quiz Routes
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/quizzes/course/:courseId',
      handler: 'api::quiz.quiz.findByCourse',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/quizzes/:id/submit',
      handler: 'api::quiz.quiz.submitQuiz',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/quizzes/:id/my-submission',
      handler: 'api::quiz.quiz.mySubmission',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
