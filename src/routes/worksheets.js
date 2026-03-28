const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Worksheet = require('../models/Worksheet');
const WorksheetTemplate = require('../models/WorksheetTemplate');
const WorksheetGenerationAgent = require('../agents/WorksheetGenerationAgent');
const OpenAI = require('openai');
const { isOptionalAuth } = require('../middleware/auth');
const actionLoggingMiddleware = require('../middleware/actionLogging');
const Joi = require('joi');

// Initialize OpenAI client and worksheet agent (only for final generation)
let openaiClient;
let worksheetAgent;

try {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
  } else {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000,
      maxRetries: 1
    });
    
    worksheetAgent = new WorksheetGenerationAgent(openaiClient, 'worksheet');
    console.log('✅ Worksheet Generation Agent initialized');
  }
} catch (error) {
  console.error('❌ Error initializing OpenAI:', error.message);
}

// Validation schemas
const generateLearningObjectivesSchema = Joi.object({
  text: Joi.string().optional().allow('', null).trim(),
  educationLevel: Joi.string().optional().valid('elementary', 'high-school', 'higher-education'),
  year: Joi.string().optional().allow('', null).trim(),
  subjectArea: Joi.string().optional().allow('', null).trim(),
  userName: Joi.string().optional().allow('', null).trim()
});

const generateFormatDescriptionSchema = Joi.object({
  educationLevel: Joi.string().required().valid('elementary', 'high-school', 'higher-education'),
  year: Joi.string().required().trim().min(1),
  subjectArea: Joi.string().required().trim().min(1),
  learningObjective: Joi.string().required().trim().min(1),
  difficultyLevel: Joi.string().required().valid('easy', 'medium', 'hard'),
  userName: Joi.string().required().trim().min(1)
});

const generateExamplesSchema = Joi.object({
  educationLevel: Joi.string().required().valid('elementary', 'high-school', 'higher-education'),
  year: Joi.string().required().trim().min(1),
  subjectArea: Joi.string().required().trim().min(1),
  learningObjective: Joi.string().required().trim().min(1),
  difficultyLevel: Joi.string().required().valid('easy', 'medium', 'hard'),
  formatDescription: Joi.string().required().trim().min(1),
  userName: Joi.string().required().trim().min(1)
});

const generateWorksheetSchema = Joi.object({
  educationLevel: Joi.string().required().valid('elementary', 'high-school', 'higher-education'),
  language: Joi.string().optional().trim().min(1),
  year: Joi.string().required().trim().min(1),
  subjectArea: Joi.string().required().trim().min(1),
  learningObjective: Joi.string().required().trim().min(1),
  difficultyLevel: Joi.string().required().valid('easy', 'medium', 'hard'),
  formatDescription: Joi.string().required().trim().min(1),
  examples: Joi.string().optional().allow('', null).trim(),
  references: Joi.string().optional().allow('', null).trim(),
  userName: Joi.string().required().trim().min(1)
});

const saveWorksheetSchema = Joi.object({
  title: Joi.string().required().trim().min(1),
  content: Joi.string().required().trim().min(1),
  educationLevel: Joi.string().required().valid('elementary', 'high-school', 'higher-education'),
  year: Joi.string().required().trim().min(1),
  language: Joi.string().optional().trim().min(1),
  subjectArea: Joi.string().required().trim().min(1),
  learningObjective: Joi.string().required().trim().min(1),
  difficultyLevel: Joi.string().required().valid('easy', 'medium', 'hard'),
  formatDescription: Joi.string().optional().default('').trim(),
  examples: Joi.string().optional().default('').trim(),
  references: Joi.string().optional().default('').trim(),
  userName: Joi.string().required().trim().min(1),
  instructionPage: Joi.string().optional().allow('').trim(),
  answerSheet: Joi.string().optional().allow('').trim(),
  generatedAt: Joi.date().optional().allow(null),
  printoutLayoutOptions: Joi.object().optional().allow(null)
});

const updateWorksheetSchema = Joi.object({
  title: Joi.string().optional().trim().min(1),
  content: Joi.string().optional().trim().min(1),
  educationLevel: Joi.string().optional().valid('elementary', 'high-school', 'higher-education'),
  year: Joi.string().optional().trim().min(1),
  language: Joi.string().optional().trim().min(1),
  subjectArea: Joi.string().optional().trim().min(1),
  learningObjective: Joi.string().optional().trim().min(1),
  difficultyLevel: Joi.string().optional().valid('easy', 'medium', 'hard'),
  formatDescription: Joi.string().optional().allow('', null).trim(),
  examples: Joi.string().optional().allow('', null).trim(),
  references: Joi.string().optional().allow('', null).trim(),
  instructionPage: Joi.string().optional().allow('', null).trim(),
  answerSheet: Joi.string().optional().allow('', null).trim(),
  printoutLayoutOptions: Joi.object().optional().allow(null),
  userName: Joi.string().required().trim().min(1)
}).min(2); // At least userName and one other field

/**
 * POST /api/v1/worksheets/generate-learning-objectives
 * Get learning objectives from worksheet_template collection
 */
router.post('/generate-learning-objectives', isOptionalAuth, actionLoggingMiddleware('generate-learning-objectives'), async (req, res) => {
  try {
    const { error, value } = generateLearningObjectivesSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const { educationLevel, year, subjectArea, userName } = value;

    // Find matching template based on provided criteria
    let template = null;
    
    // Try exact match: educationLevel + year + subjectArea
    if (educationLevel && year && subjectArea) {
      template = await WorksheetTemplate.findOne({
        education_level: educationLevel,
        year: year,
        subject: subjectArea
      });
    }
    
    // Try match: educationLevel + subjectArea (without year)
    if (!template && educationLevel && subjectArea) {
      template = await WorksheetTemplate.findOne({
        education_level: educationLevel,
        subject: subjectArea
      });
    }
    
    // Try match: educationLevel + year (without subjectArea)
    if (!template && educationLevel && year) {
      template = await WorksheetTemplate.findOne({
        education_level: educationLevel,
        year: year
      });
    }
    
    // Try match: educationLevel only
    if (!template && educationLevel) {
      template = await WorksheetTemplate.findOne({
        education_level: educationLevel
      });
    }
    
    // If still no match, get any template
    if (!template) {
      template = await WorksheetTemplate.findOne({});
    }

    if (!template || !template.learning_objectives || template.learning_objectives.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No learning objectives template found for the specified criteria'
      });
    }

    // Get 3 items from learning_objectives array
    const learningObjectives = template.learning_objectives.slice(0, 3);
    const learningObjectivesText = learningObjectives.join('\n\n');

    res.status(200).json({
      success: true,
      data: {
        learningObjectives: learningObjectivesText
      },
      processingTime: 0
    });
  } catch (error) {
    console.error('❌ Error fetching learning objectives:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch learning objectives',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/worksheets/generate-format-description
 * Get format description from worksheet_template collection
 */
router.post('/generate-format-description', isOptionalAuth, actionLoggingMiddleware('generate-format-description'), async (req, res) => {
  try {
    const { error, value } = generateFormatDescriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const { educationLevel, year, subjectArea } = value;

    // Find matching template (map camelCase to snake_case)
    let template = await WorksheetTemplate.findOne({
      education_level: educationLevel,
      year: year,
      subject: subjectArea
    });

    // If no exact match, try without year
    if (!template) {
      template = await WorksheetTemplate.findOne({
        education_level: educationLevel,
        subject: subjectArea
      });
    }

    // If still no match, try by educationLevel only
    if (!template) {
      template = await WorksheetTemplate.findOne({
        education_level: educationLevel
      });
    }

    if (!template || !template.format_description) {
      return res.status(404).json({
        success: false,
        message: 'No format description template found for the specified criteria'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        formatDescription: template.format_description
      },
      processingTime: 0
    });
  } catch (error) {
    console.error('❌ Error fetching format description:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch format description',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/worksheets/generate-examples
 * Get examples from worksheet_template collection
 */
router.post('/generate-examples', isOptionalAuth, actionLoggingMiddleware('generate-examples'), async (req, res) => {
  try {
    const { error, value } = generateExamplesSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const { educationLevel, year, subjectArea } = value;

    // Find matching template (map camelCase to snake_case)
    let template = await WorksheetTemplate.findOne({
      education_level: educationLevel,
      year: year,
      subject: subjectArea
    });

    // If no exact match, try without year
    if (!template) {
      template = await WorksheetTemplate.findOne({
        education_level: educationLevel,
        subject: subjectArea
      });
    }

    // If still no match, try by educationLevel only
    if (!template) {
      template = await WorksheetTemplate.findOne({
        education_level: educationLevel
      });
    }

    if (!template || !template.examples || template.examples.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No examples template found for the specified criteria'
      });
    }

    // Get 3 items from examples array
    const examples = template.examples.slice(0, 3);
    const examplesText = examples.join('\n\n');

    res.status(200).json({
      success: true,
      data: {
        examples: examplesText
      },
      processingTime: 0
    });
  } catch (error) {
    console.error('❌ Error fetching examples:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch examples',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/worksheets/generate
 * Generate complete worksheet
 */
router.post('/generate', isOptionalAuth, actionLoggingMiddleware('generate-worksheet'), async (req, res) => {
  try {
    const { error, value } = generateWorksheetSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    if (!worksheetAgent) {
      return res.status(503).json({
        success: false,
        message: 'AI service not available - configuration error',
        errorType: 'service_unavailable'
      });
    }

    const startTime = Date.now();
    const response = await worksheetAgent.process(value);
    const processingTime = Date.now() - startTime;

    if (response.success) {
      // Parse JSON response to extract instruction page, worksheet content, and answer sheet
      let instructionPage = '';
      let worksheetContent = '';
      let answerSheet = '';
      let title = 'Generated Worksheet';

      try {
        const responseText = response.response.trim();
        // Remove markdown code blocks if present
        let jsonText = responseText.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        
        // Try to find JSON object
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          
          // Handle instructionPage - keep as object for response, stringify for storage
          if (parsed.instructionPage) {
            instructionPage = typeof parsed.instructionPage === 'string' 
              ? parsed.instructionPage 
              : JSON.stringify(parsed.instructionPage, null, 2);
          }
          
          // Handle worksheetContent - extract ONLY the worksheetContent, not the entire response
          if (parsed.worksheetContent) {
            worksheetContent = typeof parsed.worksheetContent === 'string' 
              ? parsed.worksheetContent 
              : JSON.stringify(parsed.worksheetContent, null, 2);
          } else if (parsed.content) {
            // Only use parsed.content if worksheetContent is not found
            worksheetContent = typeof parsed.content === 'string' 
              ? parsed.content 
              : JSON.stringify(parsed.content, null, 2);
          } else {
            // If neither worksheetContent nor content is found, set to empty string
            // DO NOT use the entire response
            worksheetContent = '';
          }
          
          // Handle answerSheet - keep as object for response, stringify for storage
          if (parsed.answerSheet) {
            answerSheet = typeof parsed.answerSheet === 'string' 
              ? parsed.answerSheet 
              : JSON.stringify(parsed.answerSheet, null, 2);
          }
          
          // Extract title from worksheet content if available
          if (worksheetContent) {
            // If worksheetContent is a JSON string, try to parse it to get the title
            try {
              const contentObj = JSON.parse(worksheetContent);
              if (contentObj.title) {
                title = contentObj.title;
              } else {
                const lines = worksheetContent.split('\n').filter(l => l.trim());
                title = lines[0] || 'Generated Worksheet';
              }
            } catch {
              const lines = worksheetContent.split('\n').filter(l => l.trim());
              title = lines[0] || 'Generated Worksheet';
            }
          }
        } else {
          // Fallback: treat entire response as worksheet content
          worksheetContent = responseText;
          const lines = worksheetContent.split('\n').filter(l => l.trim());
          title = lines[0] || 'Generated Worksheet';
        }
      } catch (parseError) {
        console.warn('⚠️ Failed to parse JSON response, using fallback:', parseError.message);
        // Fallback: treat entire response as worksheet content
        worksheetContent = response.response || '';
        const lines = worksheetContent.split('\n').filter(l => l.trim());
        title = lines[0] || 'Generated Worksheet';
      }

      // Ensure worksheetContent is not the entire JSON response
      // If worksheetContent contains the entire response structure, extract only the worksheetContent part
      if (worksheetContent && typeof worksheetContent === 'string' && worksheetContent.includes('"instructionPage"') && worksheetContent.includes('"answerSheet"')) {
        // This means worksheetContent contains the entire JSON response, try to extract just the worksheetContent
        try {
          const fullResponse = JSON.parse(worksheetContent);
          if (fullResponse.worksheetContent) {
            worksheetContent = typeof fullResponse.worksheetContent === 'string' 
              ? fullResponse.worksheetContent 
              : JSON.stringify(fullResponse.worksheetContent, null, 2);
          }
        } catch {
          // If parsing fails, keep worksheetContent as is
        }
      }

      // Prepare objects for response
      let worksheetContentResponse = null;
      let instructionPageResponse = null;
      let answerSheetResponse = null;
      
      // worksheetContent: keep as object if possible
      if (worksheetContent) {
        if (typeof worksheetContent === 'string') {
          // Try to parse stringified JSON
          try {
            worksheetContentResponse = JSON.parse(worksheetContent);
          } catch {
            // If not JSON, keep raw string
            worksheetContentResponse = worksheetContent;
          }
        } else {
          worksheetContentResponse = worksheetContent;
        }
      }
      
      // instructionPage: keep as object if possible
      instructionPageResponse = instructionPage;
      
      // If instructionPage is a JSON string, parse it back to object for response
      if (typeof instructionPage === 'string' && instructionPage.trim().startsWith('{')) {
        try {
          instructionPageResponse = JSON.parse(instructionPage);
        } catch {
          // Keep as string if parsing fails
        }
      }
      
      // If answerSheet is a JSON string, parse it back to object for response
      if (typeof answerSheet === 'string' && answerSheet.trim().startsWith('{')) {
        try {
          answerSheetResponse = JSON.parse(answerSheet);
        } catch {
          // Keep as string if parsing fails
        }
      }

      res.status(200).json({
        success: true,
        data: {
          worksheetContent: worksheetContentResponse,
          instructionPage: instructionPageResponse,
          answerSheet: answerSheetResponse,
          title: title,
          metadata: {
            educationLevel: value.educationLevel,
            language: value.language || null,
            year: value.year,
            subjectArea: value.subjectArea,
            difficultyLevel: value.difficultyLevel,
            generatedAt: new Date().toISOString()
          }
        },
        usage: response.usage,
        usageInternal: response.usageInternal,
        processingTime: processingTime
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to generate worksheet',
        error: response.error || 'Unknown error'
      });
    }
  } catch (error) {
    console.error('❌ Error generating worksheet:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to generate worksheet',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/worksheets
 * Save a worksheet
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = saveWorksheetSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Prepare worksheet data
    const worksheetData = {
      title: value.title,
      content: value.content,
      educationLevel: value.educationLevel,
      year: value.year,
      language: value.language || null,
      subjectArea: value.subjectArea,
      learningObjective: value.learningObjective,
      difficultyLevel: value.difficultyLevel,
      formatDescription: value.formatDescription !== undefined ? value.formatDescription : '',
      examples: value.examples !== undefined ? value.examples : '',
      references: value.references !== undefined ? value.references : '',
      userName: value.userName,
      instructionPage: value.instructionPage !== undefined ? value.instructionPage : null,
      answerSheet: value.answerSheet !== undefined ? value.answerSheet : null,
      generatedAt: value.generatedAt ? new Date(value.generatedAt) : new Date(),
      printoutLayoutOptions: value.printoutLayoutOptions || null
    };

    const worksheet = new Worksheet(worksheetData);
    await worksheet.save();

    res.status(201).json({
      success: true,
      data: {
        id: worksheet._id.toString(),
        title: worksheet.title,
        content: worksheet.content,
        educationLevel: worksheet.educationLevel,
        year: worksheet.year,
        language: worksheet.language || '',
        subjectArea: worksheet.subjectArea,
        learningObjective: worksheet.learningObjective,
        difficultyLevel: worksheet.difficultyLevel,
        formatDescription: worksheet.formatDescription || '',
        examples: worksheet.examples || '',
        references: worksheet.references || '',
        userName: worksheet.userName,
        generatedAt: worksheet.generatedAt,
        printoutLayoutOptions: worksheet.printoutLayoutOptions,
        instructionPage: worksheet.instructionPage || '',
        answerSheet: worksheet.answerSheet || '',
        createdAt: worksheet.createdAt,
        updatedAt: worksheet.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error saving worksheet:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to save worksheet',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/worksheets
 * List saved worksheets with pagination and filters
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().required().trim().min(1),
      page: Joi.number().integer().min(1).optional().default(1),
      limit: Joi.number().integer().min(1).max(100).optional().default(10),
      educationLevel: Joi.string().optional().valid('elementary', 'high-school', 'higher-education'),
      subjectArea: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const { userName, page, limit, educationLevel, subjectArea } = value;
    const skip = (page - 1) * limit;

    // Build query
    const query = { userName };
    if (educationLevel) query.educationLevel = educationLevel;
    if (subjectArea) query.subjectArea = subjectArea;

    // Get total count
    const total = await Worksheet.countDocuments(query);

    // Get worksheets
    const worksheets = await Worksheet.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-content'); // Exclude content for list view

    const formattedWorksheets = worksheets.map(ws => ({
      id: ws._id.toString(),
      title: ws.title,
      educationLevel: ws.educationLevel,
      year: ws.year,
      language: ws.language || '',
      subjectArea: ws.subjectArea,
      difficultyLevel: ws.difficultyLevel,
      generatedAt: ws.generatedAt,
      printoutLayoutOptions: ws.printoutLayoutOptions,
      createdAt: ws.createdAt,
      updatedAt: ws.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: {
        worksheets: formattedWorksheets,
        pagination: {
          page: page,
          limit: limit,
          total: total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching worksheets:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve worksheets',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/worksheets/:id
 * Get a specific worksheet by ID
 */
router.get('/:id', isOptionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid worksheet ID'
      });
    }

    const worksheet = await Worksheet.findById(id);
    
    if (!worksheet) {
      return res.status(404).json({
        success: false,
        message: 'Worksheet not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: worksheet._id.toString(),
        title: worksheet.title,
        content: worksheet.content,
        educationLevel: worksheet.educationLevel,
        year: worksheet.year,
        language: worksheet.language || '',
        subjectArea: worksheet.subjectArea,
        learningObjective: worksheet.learningObjective,
        difficultyLevel: worksheet.difficultyLevel,
        formatDescription: worksheet.formatDescription || '',
        examples: worksheet.examples || '',
        references: worksheet.references || '',
        userName: worksheet.userName,
        generatedAt: worksheet.generatedAt,
        printoutLayoutOptions: worksheet.printoutLayoutOptions,
        instructionPage: worksheet.instructionPage || '',
        answerSheet: worksheet.answerSheet || '',
        createdAt: worksheet.createdAt,
        updatedAt: worksheet.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching worksheet:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve worksheet',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/worksheets/:id
 * Update an existing worksheet
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid worksheet ID'
      });
    }

    const { error, value } = updateWorksheetSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const { userName, ...updateData } = value;

    const worksheet = await Worksheet.findById(id);
    if (!worksheet) {
      return res.status(404).json({
        success: false,
        message: 'Worksheet not found'
      });
    }

    // Verify ownership
    if (worksheet.userName !== userName) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this worksheet'
      });
    }

    // Clean up empty strings to null for optional fields
    const cleanedData = {};
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        if (key === 'generatedAt' && updateData[key]) {
          cleanedData[key] = new Date(updateData[key]);
        } else {
          cleanedData[key] = updateData[key] || null;
        }
      }
    });

    Object.assign(worksheet, cleanedData);
    await worksheet.save();

    res.status(200).json({
      success: true,
      data: {
        id: worksheet._id.toString(),
        title: worksheet.title,
        content: worksheet.content,
        educationLevel: worksheet.educationLevel,
        year: worksheet.year,
        subjectArea: worksheet.subjectArea,
        learningObjective: worksheet.learningObjective,
        difficultyLevel: worksheet.difficultyLevel,
        formatDescription: worksheet.formatDescription || '',
        examples: worksheet.examples || '',
        references: worksheet.references || '',
        userName: worksheet.userName,
        generatedAt: worksheet.generatedAt,
        printoutLayoutOptions: worksheet.printoutLayoutOptions,
        instructionPage: worksheet.instructionPage || '',
        answerSheet: worksheet.answerSheet || '',
        updatedAt: worksheet.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating worksheet:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update worksheet',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/worksheets/:id
 * Delete a worksheet
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid worksheet ID'
      });
    }

    const schema = Joi.object({
      userName: Joi.string().required().trim().min(1)
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'userName is required',
        error: error.details[0].message
      });
    }

    const { userName } = value;

    const worksheet = await Worksheet.findById(id);
    if (!worksheet) {
      return res.status(404).json({
        success: false,
        message: 'Worksheet not found'
      });
    }

    // Verify ownership
    if (worksheet.userName !== userName) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this worksheet'
      });
    }

    await Worksheet.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Worksheet deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting worksheet:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete worksheet',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

