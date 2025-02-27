import gulp from 'gulp';
import pug from 'gulp-pug';
import JSON5 from 'json5';
import mjml from 'mjml';
import { minify as htmlmin } from 'html-minifier-terser';
import rename from 'gulp-rename';
import { deleteAsync } from 'del';
import through2 from 'through2';
import { load } from 'cheerio';
import liveServer from 'live-server';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs'; // Ajouté pour lire le fichier JSON

// Définit --dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fonction asynchrone pour charger les configurations JSON5
const loadConfigs = async () => {
  try {
    const dataPartenaires = JSON5.parse(await fs.readFile('./src/includes/dataPartenaires.json5', 'utf8'));
    const mjmlConfig = JSON5.parse(await fs.readFile('.mjmlConfig.json5', 'utf8'));
    return {dataPartenaires, mjmlConfig };
  } catch (error) {
    console.error('Error loading configs:', error);
    throw new Error('Failed to load configurations');
  }
};

// Tâche pour supprimer les attributs style
const removeEmptyStyles = () => {
    return through2.obj((file, _, cb) => {
      if (file.isBuffer()) {
        const $ = load(file.contents.toString());
        $('[style=""]').removeAttr('style'); // Supprimer les attributs style vides
        file.contents = Buffer.from($.html());
      }
      cb(null, file);
    });
  };

// Assurez-vous que le répertoire 'dist' existe
const ensureDistDirectory = async () => {
    try {
        await fs.mkdir('./dist', { recursive: true });
        console.log('Directory "dist" created or already exists.');
    } catch (error) {
        console.error('Error creating directory "dist":', error);
    }
};

// Serveur
const serve = (done) => {
    const params = {
        port: 8080,
        root: path.resolve(__dirname, './dist'),
        open: true,
        file: 'index.html',
        wait: 500,
        logLevel: 2, //Niveau de journalisation (0 = désactivé, 1 = erreurs, 2 = infos, 3 = debogage )
    };
    try {
        liveServer.start(params);
        console.log('Live Server started on port', params.port);
    } catch (error){
        console.error('Error starting Live Server:', error);
    }
    done();
};

const cleanDist = () => {
    // Utilise deleteAsync au lieu de del
    return deleteAsync(['./dist/*', '!./dist/images']);
};

// Pug vers Mjml
const pugToMjml = async () => {
    const data = await loadConfigs();
    const dataPartenaires = data.dataPartenaires;
    // Vérifiez que dataHotellerie est bien définie
    if (!dataPartenaires) {
        throw new Error('dataParenaires is not defined. Check the loadConfigs function.');
    }
    console.log('Data loaded:', dataPartenaires);
    // Déclarez vos listes de logos ici
    const logosList1 = dataPartenaires.logosList1 || [];
    const logosList2 = dataPartenaires.logosList2 || [];
    const logosList3 = dataPartenaires.logosList3 || [];
    const logosList4 = dataPartenaires.logosList4 || [];
    return gulp.src('./src/*.pug')
        .pipe(pug({
            locals: {
                logosList1,
                logosList2,
                logosList3,
                logosList4,
                ...dataPartenaires // Passez les données JSON au template Pug
            },
            pretty: true, // À retirer pour la production
            debug: false, // À retirer pour la production
            compileDebug: false,
            globals: [],
            self: false,
        }))
        .on('error', function(err) {  // Ajout de la gestion d'erreur ici
            console.error('Pug Error:', err.message);
            this.emit('end'); // Permet au watch de continuer
        })
        .pipe(rename({ extname: '.mjml' }))
        .pipe(gulp.dest('./src/mjml'));
};

// Mjml vers HTML
const mjmlToHtml = async () => {
    const { mjmlConfig } = await loadConfigs();
    return gulp.src('./src/mjml/*.mjml')
    .pipe(through2.obj((file, _, cb) => {
        try {
            const mjmlContent = file.contents.toString();
            const result = mjml(mjmlContent, {
                ...mjmlConfig,  // Ici, utilise mjmlConfig directement
                filePath: file.path // Ajout du chemin du fichier pour les imports relatifs
            });
            
            if (result.errors && result.errors.length) {
                console.error('MJML Errors:', result.errors);
                return cb(new Error('MJML compilation failed'));
            }
            
            file.contents = Buffer.from(result.html);
            cb(null, file);
        } catch (error) {
            console.error('Erreur dans le fichier:', file.path);
            console.error(error.message);
            cb(error);
        }
    }))
    .pipe(rename({ extname: '.html' }))
    .on('error', function(err) {
        console.error('Rename Error:', err.message);
        this.emit('end');
    })
    .pipe(removeEmptyStyles())
    .on('error', function(err) {
        console.error('Style Removal Error:', err.message);
        this.emit('end');
    })
    .pipe(gulp.dest('./dist'));
};


const minifyHtml = () => {
    // Au lieu de créer et retourner une Promise avec setTimeout
    console.log('Starting minifyHtml task...');
    return gulp.src(['./dist/*.html', '!./dist/*.min.html'])
        .pipe(through2.obj(async (file, enc, callback) => {
            if (file.isBuffer()) {
                try {
                    const minified = await htmlmin(String(file.contents), {
                        collapseWhitespace: true,
                        removeComments: false,
                        removeEmptyAttributes: true,
                        minifyCSS: true,
                        conservativeCollapse: false,
                        preserveLineBreaks: false,
                        processConditionalComments: true,
                        minifyJS: true,
                        caseSensitive: true,
                        keepClosingSlash: true,
                        html5: false
                    });
                    file.contents = Buffer.from(minified);
                } catch (error) {
                    console.error(`Error minifying file: ${file.path}`, error);
                }
            } else {
                console.warn(`File is not a buffer: ${file.path}`);
            }
            callback(null, file);
        }))
        .pipe(rename({ suffix: '.min' }))
        .pipe(gulp.dest('dist'));
};

// Vérification du poids et des attributs alt
const customFilesize = () => {
    return through2.obj(function (file, _, cb) {
        if (file.isBuffer()) {
            const fileSizeInKB = file.contents.length / 1024;
            const fileName = path.basename(file.path);
            console.log(`${fileName}: ${fileSizeInKB.toFixed(2)} Ko`);
        } else {
            console.warn(`File is not a buffer: ${file.path}`);
        }
        cb(null, file);
    });
};

const verification = () => {
    console.log('Starting verification task...');
    return gulp.src('dist/*.html')
        .pipe(customFilesize())
        .pipe(gulp.dest('dist'));
};

// Watch
const watch = () => {
    gulp.watch('./src/**/*.pug', gulp.series(pugToMjml, mjmlToHtml, minifyHtml, verification,));
};

const defaultTask = gulp.series(
    cleanDist,
    ensureDistDirectory,
    pugToMjml,
    mjmlToHtml,
    minifyHtml,
    verification,
    serve,
    watch
  );

// Export des tâches
export { serve, verification, cleanDist, pugToMjml, mjmlToHtml, minifyHtml, watch, defaultTask as default };