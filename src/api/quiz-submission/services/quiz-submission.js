'use strict';

/**
 * quiz-submission service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::quiz-submission.quiz-submission');
