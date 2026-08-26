'use strict';

/**
 * enroll service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::enroll.enroll');
