import { defineConfig } from 'vite'

export default defineConfig({
    root: 'sistema',
    build: {
        outDir: '../dist',
        emptyOutDir: true
    },
    server: {
        proxy: {
            '/webhook/seatalk': {
                target: 'https://openapi.seatalk.io',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/webhook\/seatalk/, '/webhook/group/VbUrDrLiQ5WZmjUKv0LOUw'),
                secure: true
            }
        }
    }
})
