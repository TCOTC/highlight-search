import { resolve } from "path"
import { readdirSync } from "node:fs"
import { defineConfig } from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy"
import zipPack from "vite-plugin-zip-pack";

const isWatch = process.argv.includes("--watch") || process.argv.includes("-w")
// watch 时直接输出到插件根目录，供思源加载；正式构建仍输出到 dist 并打 zip
const distDir = isWatch ? "." : "./dist"

console.log("isWatch=>", isWatch)
console.log("distDir=>", distDir)

export default defineConfig({
    plugins: [
        viteStaticCopy({
            targets: [
                // 思源从插件根目录读 i18n，watch / build 都需要复制
                {
                    src: "./src/i18n/*.json",
                    dest: "./i18n",
                },
                // 正式构建再把其余静态资源打进 dist
                ...(isWatch ? [] : [
                    {
                        src: "./README*.md",
                        dest: "./",
                    },
                    {
                        src: "./icon.png",
                        dest: "./",
                    },
                    {
                        src: "./preview.png",
                        dest: "./",
                    },
                    {
                        src: "./plugin.json",
                        dest: "./",
                    },
                ]),
            ],
        }),
    ],

    // https://github.com/vitejs/vite/issues/1930
    // https://vitejs.dev/guide/env-and-mode.html#env-files
    // https://github.com/vitejs/vite/discussions/3058#discussioncomment-2115319
    // 在这里自定义变量
    define: {
        "process.env.DEV_MODE": `"${isWatch}"`,
        "process.env.NODE_ENV": `"${isWatch ? 'development' : 'production'}"`,
        "process.env": {},
    },

    build: {
        // 输出路径
        outDir: distDir,
        emptyOutDir: false,

        // watch 用 inline，思源通过 eval 加载插件，外链 .map 无法解析
        sourcemap: isWatch ? "inline" : false,

        // 设置为 false 可以禁用最小化混淆
        // 或是用来指定是应用哪种混淆器
        // boolean | 'terser' | 'esbuild'
        // 不压缩，用于调试
        minify: !isWatch,

        lib: {
            // Could also be a dictionary or array of multiple entry points
            entry: resolve(__dirname, "src/index.ts"),
            // the proper extensions will be added
            fileName: "index",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: [
                ...(
                    isWatch ? [
                        {
                            //监听静态资源文件
                            name: 'watch-external',
                            async buildStart() {
                                const i18nFiles = readdirSync('./src/i18n').map(f => `src/i18n/${f}`);
                                const readmeFiles = readdirSync('.').filter(f => f.startsWith('README') && f.endsWith('.md')).map(f => `./${f}`);
                                for (const file of [...i18nFiles, ...readmeFiles, './plugin.json']) {
                                    this.addWatchFile(file);
                                }
                            }
                        }
                    ] : [
                        zipPack({
                            inDir: './dist',
                            outDir: './',
                            outFileName: 'package.zip'
                        })
                    ]
                )
            ],

            // make sure to externalize deps that shouldn't be bundled
            // into your library
            external: ["siyuan", "process"],

            output: {
                entryFileNames: "[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") {
                        return "index.css"
                    }
                    return assetInfo.name
                },
            },
        },
    }
})
