const Joi = require('joi');

const validateRegistration = (req, res, next) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    name: Joi.string().min(2).required(),
    role: Joi.string().valid('admin', 'api_owner', 'consumer')
  });
  
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

const validateApiCreation = (req, res, next) => {
  const schema = Joi.object({
    name: Joi.string().required(),
    description: Joi.string(),
    baseUrl: Joi.string().uri().required(),
    endpoint: Joi.string(),
    method: Joi.string().valid('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
    rateLimit: Joi.object({
      perMinute: Joi.number().min(1),
      perHour: Joi.number().min(1),
      perDay: Joi.number().min(1)
    }),
    pricing: Joi.object({
      freeTier: Joi.number().min(0),
      perRequestPrice: Joi.number().min(0),
      currency: Joi.string().length(3)
    })
  });
  
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

module.exports = { validateRegistration, validateApiCreation };