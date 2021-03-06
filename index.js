const fs = require("fs");
const { exec } = require("child_process");

const generateSequelizeModel = require("./src/generateModel");
const { startFuse, stopFuse } = require("./src/fuse");

// process has to be called with at least 2 command line arguments for modelName and inputPath
if (process.argv.length < 4) {
  throw Error("Not enough arguments provided, script expects a modelName and an input file path");
}

const [modelName, inputPath] = process.argv.slice(2, 4);

// all further args, used for creating multiple models
const otherInputPaths = process.argv.slice(4);

// some checks for our inputPaths
try {
  [inputPath, ...otherInputPaths].forEach((path) => {
    const fileExtension = path.split(".")[path.split(".").length - 1];
    if (fileExtension.toLowerCase() !== "json") {
      throw Error("wrong file extension");
    }
  });
} catch (e) {
  throw Error("file does not have the necessary .json file extension");
}

/**
 *
 * @param {String} name - name of model to create
 * @param {String} path - path to json file containing examples
 */
function createModel(name, path) {
  const examples = JSON.parse(fs.readFileSync(path));

  console.log(`\nFound ${examples.length} examples for model: ${name}`);
  console.log(`Generating model: ${name}`);

  const associations = generateSequelizeModel(name, examples);
  return associations;
}

/**
 * Creates a index.js file containing imports/exports and associations for sequelize models
 * @param {Object} associations - Object containing association types of models
 */
function writeIndexFile(associations) {
  let indexTemplate = fs.readFileSync("./templates/index.js.tmp").toString();

  const importStatements = [];
  const modelNames = [];
  const relations = [];

  Object.keys(associations).forEach((name) => {
    const model = associations[name];
    // create imports
    const importStatement = `const ${name} = require("./${name}")(sequelize, Sequelize);`;
    importStatements.push(importStatement);

    // create 1:n associations
    model.associations["1:n"].forEach((subModel) => {
      const subModelName = subModel.name;
      const hasStmt = `${name}.hasMany(${subModelName})`;
      const belongsStmt = `${subModelName}.belongsTo(${name})`;
      relations.push(hasStmt, belongsStmt);
      if (associations[subModelName]) {
        return;
      }
      const stmt = `const ${subModelName} = require("./${subModelName}")(sequelize, Sequelize);`;
      importStatements.push(stmt);
      modelNames.push(subModelName);
    });

    // create 1:1 associations
    model.associations["1:1"].forEach((subModel) => {
      const subModelName = subModel.name;
      const hasStmt = `${name}.hasOne(${subModelName});`;
      const belongsStmt = `${subModelName}.belongsTo(${name});`;
      relations.push(hasStmt, belongsStmt);
      if (associations[subModelName]) {
        return;
      }
      const stmt = `const ${subModelName} = require("./${subModelName}")(sequelize, Sequelize);`;
      importStatements.push(stmt);
      modelNames.push(subModelName);
    });
    modelNames.push(name);
  });

  // replace "code" in index.js template
  indexTemplate = indexTemplate.replace("{{imports}}", importStatements.join("\n"))
    .replace("{{relations}}", relations.join("\n"))
    .replace("{{modelNames}}", modelNames.join(",\n"));

  // write file from template
  if (!fs.existsSync("./models")) {
    fs.mkdirSync("./models");
  }
  fs.writeFileSync("./models/index.js", indexTemplate);
}

// start a nice animated progress bar
const intervalId = startFuse(30, 1, 38);

// create main model and object containing info about models associations
const associations = {};

const [mainModel, ...otherModels] = createModel(modelName, inputPath);
associations[modelName] = mainModel;
otherModels.forEach((model) => {
  associations[model.model] = model;
});

// create other models from otherInputPaths
otherInputPaths.forEach((path) => {
  const inferredModelName = path.split("/")[path.split("/").length - 1].split(".json")[0];
  const [inferredMainModel, ...inferredOtherModels] = createModel(inferredModelName, path);
  associations[inferredModelName] = inferredMainModel;
  inferredOtherModels.forEach((model) => {
    associations[model.model] = model;
  });
});

// write index file after the individual models have been created
writeIndexFile(associations);

// cleanup generated models by formatting them using eslint
const eslintProcess = exec("eslint ./models --fix", (error) => {
  if (error) {
    console.log("\nEslint errored, you might want to check the generated model files");
  }
});

eslintProcess.on("exit", () => {
  console.log("\nFinished generating Sequelize models.");

  // stop non-determinate progress bar
  stopFuse(intervalId);
});
