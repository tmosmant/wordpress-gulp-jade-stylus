/**
 * This Gulp script generates Wordpress themes using Jade + Stylus
 *
 * TODO:
 * + Install Wordpress only if it hasn't been installed yet
 */

var fs = require('fs');
var _ = require('lodash');

var gulp = require('gulp');
var download = require('gulp-download');
var unzip = require('gulp-unzip');
var jade = require('gulp-jade-php');
var concat = require('gulp-concat');
var wrap = require('gulp-wrap');
var gulpif = require('gulp-if');
var stylus = require('gulp-stylus');
var uglify = require('gulp-uglify');
var order = require('gulp-order');
var plumber = require('gulp-plumber');
var minifyCSS = require('gulp-clean-css');
var imagemin = require('gulp-imagemin');
var cache = require('gulp-cached');
var pot = require('gulp-wp-pot');
var sort = require('gulp-sort');
var replace = require('gulp-replace');
var gettext = require('gulp-gettext');

var nib = require('nib');
var jeet = require('jeet');

var del = require('del');

var hasFile = fs.existsSync;
var utils = require('./utils');

/**
 * Configuration object, following this priority:
 * 1°) the default parameters
 * 2°) the config.json file at the root
 * 3°) the arguments
 */

var config = _.merge({
  latestWordpressURL: 'https://wordpress.org/latest.zip',
  production: false,
  locals: {
    version: Date.now()
  },
  server: {
    logPrefix: 'Server',
    port: 8080,
    open: false,
    notify: false
  }
}, require('./config.json'), require('yargs').argv);

if (_.isUndefined(config.domain) && !_.isUndefined(config.theme)) {
  config.domain = _.kebabCase(config.theme);
}

/**
 * Configuring browser-sync
 * This is obviously ugly because we don't install browser-sync in production
 */

if (config.production) {
  var server = {
    stream: function() {
      return true;
    }
  };
} else {
  var server = require('browser-sync').create();
}

/**
 * The assets paths
 */

var paths = {
  root: 'themes/' + config.theme,
  config: 'themes/' + config.theme + '/config.json',
  stylesheets: 'themes/' + config.theme + '/stylesheets',
  languages: 'themes/' + config.theme + '/languages/*.po',
  javascripts: 'themes/' + config.theme + '/javascripts/**/*.js',
  templates: 'themes/' + config.theme + '/templates/**/*.jade',
  images: 'themes/' + config.theme + '/images/**/*',
  functions: 'themes/' + config.theme + '/functions.php',
  destination: 'public/wp-content/themes/' + config.theme
};

paths.misc = [
  '!' + paths.root + '/{templates,javascripts,stylesheets,languages,images}/**/*',
  '!' + paths.root + '/{templates,javascripts,stylesheets,languages,images,config.json,functions.php}',
  paths.root + '/**/*'
];

/**
 * Creates the `public` folder from unzipping the latest Wordpress release
 */

gulp.task('install', ['download', 'unzip', 'rename', 'delete']);

/**
 * Downloads the latest Wordpress release
 */

gulp.task('download', function() {
  return download(config.latestWordpressURL).pipe(gulp.dest(__dirname + '/tmp'));
});

/**
 * Unzips the latest release to the current directory
 */

gulp.task('unzip', ['download'], function() {
  return gulp.src(__dirname + '/tmp/latest.zip')
             .pipe(unzip())
             .pipe(gulp.dest(__dirname));
});

/**
 * Copies all the files in the `wordpress` folder to a `public` folder
 */

gulp.task('rename', ['unzip'], function() {
  return gulp.src(__dirname + '/wordpress/**/*')
             .pipe(gulp.dest(__dirname + '/public'));
});

/**
 * Deletes the previously created `wordpress` folder
 */

gulp.task('delete', ['rename'], function(callback) {
  return del([
    __dirname + '/wordpress',
    __dirname + '/tmp'
  ], callback);
});

/**
 * Compiles all the javascripts files into a core.js file
 * If we're running this in production, minifies the file
 */

gulp.task('compileJavascripts', function() {
  var fileName = 'core.js';

  return gulp.src(paths.javascripts)
             .pipe(plumber())
             .pipe(order([ 'jquery.js' ]))
             .pipe(concat(fileName))
             .pipe(gulpif(config.production, uglify({compress: false})))
             .pipe(gulp.dest(paths.destination))
             .pipe(gulpif(!config.production, server.stream()));
});

/**
 * Compiles the Stylus style.styl file into a style.css file at the theme's root
 * Also appends the config.json file at the top of the style.css, based on the
 * css-template.txt file
 */

gulp.task('compileStylesheets', function() {
  var configPath = __dirname + '/' + paths.config;
  var themeMeta = false;

  if (hasFile(configPath)) {
    var json = require(configPath);

    if (_.isUndefined(json['text-domain'])) {
      json['text-domain'] = config.domain;
    }
    themeMeta = utils.parseConfigFile(json);
  }

  return gulp.src(paths.stylesheets + '/style.styl')
             .pipe(plumber())
             .pipe(stylus({ use: [nib(), jeet()] }))
             .pipe(gulpif(!!themeMeta, wrap({ src: __dirname + '/css-template.txt'}, { meta: themeMeta })))
             .pipe(gulpif(config.production, minifyCSS()))
             .pipe(gulp.dest(paths.destination))
             .pipe(gulpif(!config.production, server.stream()));
});

/**
 * Compiles Jade templates into theme directory
 */

gulp.task('compileTemplates', function() {
  return gulp.src(paths.templates)
             .pipe(plumber())
             .pipe(jade({ locals: config.locals }))
             .pipe(gulp.dest(paths.destination))
             .pipe(gulpif(!config.production, server.stream()));
});

/**
 * Analyzes PHP files and generates a POT file
 */

gulp.task('compilePOT', ['compileTemplates'], function() {
  var configPath = __dirname + '/' + paths.config;
  var potConfig = {
    domain: config.domain
  };

  if (hasFile(configPath)) {
    var json = require(configPath);

    if (!_.isUndefined(json['author-uri'])) {
      potConfig.bugReport = json['author-uri'];
    }
    if (!_.isUndefined(json['author'])) {
      potConfig.team = json['author'];
    }
  }

  return gulp.src(paths.destination + '/**/*.php')
             .pipe(sort())
             .pipe(replace('$text_domain', '"' + config.domain + '"'))
             .pipe(pot(potConfig))
             .pipe(gulp.dest(paths.destination + '/languages'))
             .pipe(gulp.dest(paths.root + '/languages'));
});

/**
 * Compiles PO files into MO files
 */

gulp.task('compilePO', function() {
  return gulp.src(paths.languages)
             .pipe(gettext())
             .pipe(gulp.dest(paths.destination + '/languages'))
             .pipe(gulpif(!config.production, server.stream()));
});


/**
 * Compress images into theme directory
 */

gulp.task('compileImages', function() {
  return gulp.src(paths.images)
             .pipe(plumber())
             .pipe(cache('images'))
             .pipe(imagemin())
             .pipe(gulp.dest(paths.destination + '/images'))
             .pipe(gulpif(!config.production, server.stream()));
});

/**
 * Add the text domain into the functions.php file and automatically reloads the page when the functions.php changes
 */

gulp.task('compileFunctions', function() {
  return gulp.src(paths.functions)
             .pipe(plumber())
             .pipe(replace('$text_domain', '"' + config.domain + '"'))
             .pipe(wrap('<?php global $text_domain; $text_domain = "' + config.domain + '"; ?><%= contents %>'))
             .pipe(gulp.dest(paths.destination))
             .pipe(gulpif(!config.production, server.stream()));
});

/**
 * Copy all the files in themes that are not in the
 * templates/javascripts/stylesheets folders or the config.json file
 */

gulp.task('compileMisc', function() {
  return gulp.src(paths.misc)
             .pipe(gulp.dest(paths.destination));
});

/**
 * Compiles all the assets
 */

gulp.task('compile', function() {
  var tasks = ['compileTemplates', 'compileStylesheets', 'compileJavascripts', 'compileImages', 'compileFunctions', 'compilePOT', 'compilePO', 'compileMisc'];

  if (!hasFile(__dirname + '/public') && !config.production) {
    tasks.unshift('install');
  }

  return gulp.start(tasks);
});

/**
 * Watch all the assets
 */

gulp.task('watch', function() {
  gulp.watch([paths.stylesheets + '/**/*.styl', paths.config], ['compileStylesheets']);
  gulp.watch([paths.templates], ['compileTemplates', 'compilePOT']);
  gulp.watch([paths.javascripts], ['compileJavascripts']);
  gulp.watch([paths.images], ['compileImages']);
  gulp.watch([paths.functions], ['compileFunctions']);
  gulp.watch([paths.languages], ['compilePO']);
});

/**
 * Starts the live-reloaded web server
 */

gulp.task('live-reload', function() {
  return server.init(config.server);
});

/**
 * Cleans everything by deleting newly created folders
 */

gulp.task('hard-clean', function(callback) {
  return del([
    __dirname + '/public',
    __dirname + '/wordpress',
    __dirname + '/tmp'
  ], callback);
});

/**
 * Compiles then watch assets if not in production
 */

gulp.task('default', ['compile'], function() {
  if (!config.production) {
    gulp.start('watch');
    if (!!config.server && !_.isUndefined(config.server.proxy)) {
      gulp.start('live-reload');
    }
  }
});
