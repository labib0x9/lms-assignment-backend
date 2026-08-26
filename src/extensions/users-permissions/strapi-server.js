'use strict';

module.exports = (plugin) => {
  const originalJwtService = plugin.services.jwt;

  plugin.services.jwt = (context) => {
    const service = originalJwtService(context);

    return {
      ...service,
      issue(payload, jwtOptions) {
        console.log('🔥 JWT Payload being signed:', payload);
        return service.issue(payload, jwtOptions);
      },
    };
  };

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
            const roleType = user.role.type || user.role.name;

            // 1. Attach role to user object in response
            ctx.body.user.role = {
              id: user.role.id,
              name: user.role.name,
              type: user.role.type,
            };

            // 2. Sign JWT token with role included
            ctx.body.jwt = strapi
              .plugin('users-permissions')
              .service('jwt')
              .issue({
                id: user.id,
                role: roleType,
              });
          }
        }
      },
      // Register
      register: async (ctx) => {
        await controller.register(ctx);

        if (ctx.body && ctx.body.user && ctx.body.user.id) {
          const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: ctx.body.user.id },
            populate: ['role'],
          });

          if (user && user.role) {
            const roleType = user.role.type || user.role.name;

            // 1. Attach role to user object in response
            ctx.body.user.role = {
              id: user.role.id,
              name: user.role.name,
              type: user.role.type,
            };

            // 2. Sign JWT token with role included
            ctx.body.jwt = strapi
              .plugin('users-permissions')
              .service('jwt')
              .issue({
                id: user.id,
                role: roleType,
              });
          }
        }
      },
    };
  };

  return plugin;
};
