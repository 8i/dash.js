const path = require('path');
const pkg = require('../package.json');
const webpack = require('webpack');

const commonConfig = {
    devtool: 'source-map',
    target: "web",
    plugins: [
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
      new webpack.ProvidePlugin({
        process: 'process/browser',
      }),
    ],
    module: {
        rules: [
            {
                test: /\.(js)$/,
                use: [
                    {
                        loader: 'string-replace-loader',
                        options: {
                            search: '__VERSION__',
                            replace: pkg.version,
                        },
                    },
                    {
                        loader: 'babel-loader',
                        options: {
                            targets: 'defaults',
                            presets: ['@babel/preset-env']
                        },
                    },
                ],
            },
        ],
    },
    //Webpack 5 no longer polyfills Node.js core modules automatically
    resolve: {
        fallback: {
            "stream": require.resolve("stream-browserify"),
            buffer: require.resolve('buffer'),
        },
    },
}

const umdConfig = {
    ...commonConfig,
    output: {
        path: path.resolve(__dirname, '../dist'),
        publicPath: '/dist/',
        library: 'dashjs',
        libraryTarget: 'umd',
        libraryExport: 'default'
    },
};

const esmConfig = {
    ...commonConfig,
    experiments: {
        outputModule: true
    },
    output: {
        path: path.resolve(__dirname, '../dist/esm'),
        publicPath: '/dist/esm/',
        library: {
            type: 'module',
        },
        libraryExport: 'default',
    },
};

module.exports = { umdConfig, esmConfig };