(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['exports'], factory);
    } else if (typeof exports === 'object' && typeof exports.nodeName !== 'string') {
        // CommonJS
        factory(exports);
    } else {
        // Browser globals
        factory((root.GLSLProgram = {}));
    }
}(typeof self !== 'undefined' ? self : this, function (exports) {
    'use strict';
    
    /** @module GLSLProgram */

    function compileShader(gl, type, src) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compile error: ${type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'}\n${log}`);
        }
        return shader;
    }

    // handles creating and linking GLSL program 
    exports.createProgram = function (gl, vsSource, fsSource, transformFeedbackVaryings, options = {}) {
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);

        if (transformFeedbackVaryings && transformFeedbackVaryings.length > 0) {
            const bufferMode = options.bufferMode || gl.SEPARATE_ATTRIBS;
            gl.transformFeedbackVaryings(program, transformFeedbackVaryings, bufferMode);
        }

        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error("Program link error:", gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            throw new Error("Failed to link program.");
        }
        
        // Detach and delete shaders after successful link
        gl.detachShader(program, vertexShader);
        gl.detachShader(program, fragmentShader);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        return program;
    }

}));