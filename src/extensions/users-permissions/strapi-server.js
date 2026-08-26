'use strict';

module.exports = (plugin) => {
  const originalJwtService = plugin.services.jwt;

  plugin.services.jwt = (context) => {
    const service = originalJwtService(context);

    return {
      ...service,
      issue(payload, jwtOptions) {
        // console.log('JWT Payload:', payload);
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
        const requestedRole = (ctx.request.body.role || 'student').toLowerCase();
        const isStudent = requestedRole === 'student';

        // Strip role from request body before default Strapi validation
        if ('role' in ctx.request.body) {
          delete ctx.request.body.role;
        }

        await controller.register(ctx);

        if (ctx.body && ctx.body.user && ctx.body.user.id) {
          // 1. Find target role in database
          const targetRole = await strapi.db.query('plugin::users-permissions.role').findOne({
            where: {
              $or: [
                { type: requestedRole },
                { name: requestedRole },
              ],
            },
          });

          // 2. Assign role & set blocked: true for non-students (requires admin approval)
          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: ctx.body.user.id },
            data: {
              role: targetRole ? targetRole.id : undefined,
              blocked: !isStudent,
            },
          });

          // 3. Fetch updated user
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

          // 4. Handle JWT token & response message based on role
          if (isStudent) {
            // Students receive JWT immediately for direct dashboard access
            ctx.body.jwt = strapi
              .plugin('users-permissions')
              .service('jwt')
              .issue({
                id: user.id,
                role: user.role?.type || user.role?.name,
              });
          } else {
            // Instructors / Admins / Content Managers must wait for admin approval
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
