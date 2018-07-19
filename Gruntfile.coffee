module.exports = (grunt) ->

  grunt.initConfig
    pkg: grunt.file.readJSON("package.json")

    clean:
      build: ["public"]

    # If you want to minify more files - rather than just copy them over -
    # add them to the (!) exception list below
    copy:
      minified_js:
        files: [
          {
            src: [
              "*.min.js",
              "!shared.min.js",
              "!wallet.min.js",
              "!bitcoinjs.js",
              "!blockchainapi.js"
            ],
            dest: "public/"
          }
        ],
      js:
        files: [
          {
            src: [
              "shared.js",
              "wallet.js",
              "bitcoinjs.js",
              "blockchainapi.js"
            ]
            dest: "public/"
          }
        ]
        options:
          process: (content, srcpath) ->
            content
            .replace(/root = '\/'/,"root = 'https://blockchain.info/'")
            .replace(/var resource = '\/Resources\/'/, "var resource = ''")

    watch:
      js:
        files: ['*.js']
        tasks: ['copy:js']
        options:
          spawn: false

  grunt.loadNpmTasks('grunt-contrib-copy')
  grunt.loadNpmTasks('grunt-contrib-clean')
  grunt.loadNpmTasks('grunt-contrib-watch')

  grunt.registerTask "build", [
    "clean"
    "copy:minified_js" # All minified Javascript in root folder, except...
    "copy:js"          # Copy 4 non-minified js files and replace root url
  ]

  grunt.registerTask "default", [
    "build"
    "watch"
  ]

  return
