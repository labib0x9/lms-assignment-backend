'use strict';

module.exports = (plugin) => {

  const originalAuthController = plugin.controllers.auth;

  plugin.controllers.auth = (context) => {
    const controller = originalAuthController(context);

    return {
      ...controller,
      // Login
      callback: async (ctx) => {
        await controller.callback(ctx);

        if (ctx.body && ctx.body.user && ctx.body.user.id) {
          const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: ctx.body.user.id },
            populate: ['role'],
          });

          if (user && user.role) {

            ctx.body.user.role = {
              id: user.role.id,
              name: user.role.name,
              type: user.role.type,
            };

            ctx.body.jwt = strapi
              .plugin('users-permissions')
              .service('jwt')
              .issue({
                id: user.id,
                role: user.role.type,
              });
          }
        }
      },
      // Register
      register: async (ctx) => {
        const requestedRole = (ctx.request.body.role || 'student').toLowerCase();
        const isStudent = requestedRole === 'student';

        // Strip role from request body before default Strapi validation
        if ('role' in ctx.request.body) {
          delete ctx.request.body.role;
        }

        await controller.register(ctx);

        if (ctx.body && ctx.body.user && ctx.body.user.id) {
          const targetRole = await strapi.db.query('plugin::users-permissions.role').findOne({
            where: {
              $or: [
                { type: requestedRole },
                { name: requestedRole },
              ],
            },
          });

          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: ctx.body.user.id },
            data: {
              role: targetRole ? targetRole.id : undefined,
              blocked: !isStudent,
            },
          });

          const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: ctx.body.user.id },
            populate: ['role'],
          });

          if (user && user.role) {
            ctx.body.user.role = {
              id: user.role.id,
              name: user.role.name,
              type: user.role.type,
            };
          }

          if (isStudent) {
            ctx.body.jwt = strapi
              .plugin('users-permissions')
              .service('jwt')
              .issue({
                id: user.id,
                role: user.role?.type,
              });
          } else {
            delete ctx.body.jwt;
            ctx.body.message =
              'Registration submitted! Your account is pending administrator approval before you can log in.';
          }
        }
      },
    };
  };

  return plugin;
};
