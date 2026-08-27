'use strict';

/**
 * lesson router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::lesson.lesson', {
  config: {
    findOne: {
      policies: ['global::can-view-lesson'],
    },
    create: {
      policies: ['global::is-lesson-owner'],
    },
    update: {
      policies: ['global::is-lesson-owner'],
    },
    delete: {
      policies: ['global::is-lesson-owner'],
    },
  },
});
