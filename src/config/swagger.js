const swaggerJsdoc = require("swagger-jsdoc");

/**
 * Build OpenAPI document for /api-docs and /api-docs.json.
 * @param {string} basePath - e.g. "" or "/microapi"
 */
function createSwaggerSpec(basePath = "") {
  const serverUrl = process.env.SERVER_URL || "http://localhost:3000";
  const prefix = basePath || "";

  const options = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "InnSpill Backend API",
        version: "1.0.0",
        description: "REST API for InnSpill / AI4EDU course and assessment workflows",
      },
      servers: [{ url: `${serverUrl}${prefix}` }],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "connect.sid",
          },
        },
      },
      security: [{ cookieAuth: [] }],
    },
    apis: [],
  };

  return swaggerJsdoc(options);
}

module.exports = { createSwaggerSpec };
