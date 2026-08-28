'use strict';

/**
 * Custom progress routes
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/progresses/toggle-lesson',
      handler: 'api::progress.progress.toggleLesson',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/progresses/course/:courseId',
      handler: 'api::progress.progress.findByCourse',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
