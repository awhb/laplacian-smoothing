(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['exports'], factory);
    } else if (typeof exports === 'object' && typeof exports.nodeName !== 'string') {
        // CommonJS
        factory(exports);
    } else {
        // Browser globals
        factory((root.MyModule = {}));
    }
}(typeof self !== 'undefined' ? self : this, function (exports) {
    'use strict';
    
    // Private variables and functions
    let version = '1.0.0';
    
    function privateHelper(value) {
        return value ? value.toString().trim() : '';
    }
    
    // Public API
    exports.action = function() {
        return 'Action executed successfully!';
    };
    
    exports.processData = function(data) {
        if (!data) {
            throw new Error('Data is required');
        }
        return privateHelper(data).toUpperCase();
    };
    
    exports.calculate = function(a, b) {
        return (a || 0) + (b || 0);
    };
    
    exports.getVersion = function() {
        return version;
    };
    
    // Object constructor
    exports.Counter = function(initialValue) {
        this.value = initialValue || 0;
    };
    
    exports.Counter.prototype.increment = function() {
        this.value++;
        return this;
    };
    
    exports.Counter.prototype.decrement = function() {
        this.value--;
        return this;
    };
    
    exports.Counter.prototype.getValue = function() {
        return this.value;
    };
    
    exports.Counter.prototype.reset = function() {
        this.value = 0;
        return this;
    };
}));