// Random number generator - requires a PRNG backend, e.g. prng4.js

// For best results, put code like
// <body onClick='rng_seed_time();' onKeyPress='rng_seed_time();'>
// in your main HTML document.

var rng_state;
var rng_pool;
var rng_pptr;

// Mix in integer of n bits into the pool
function rng_seed_int(x, n) {
    if (!n) n = 32;
    for (var i = 0; i <= n-8; i += 8) {
        if (x >> i) rng_pool[rng_pptr++] ^= (x >> i) & 255;
        if (rng_pptr >= rng_psize) rng_pptr -= rng_psize;
    }
}


// Mix in the current time (w/milliseconds) into the pool
function rng_seed_time() {
    rng_seed_int(new Date().getTime());
}

// Initialize the pool with junk if needed.
if(rng_pool == null) {
    rng_pool = new Array();
    rng_pptr = 0;

    var mCrypto = _window.crypto || _window.msCrypto;

    if (mCrypto && mCrypto.getRandomValues && typeof Int32Array != 'undefined') {
         var word_array = new Int32Array(rng_psize/4);

         mCrypto.getRandomValues(word_array);

         for(var i = 0; i < word_array.length; ++i) {
             rng_seed_int(word_array[i]);
         }
     }

     for (var ii = 0; ii < rng_psize/2; ++ii) {  // extract some randomness from Math.random()
         rng_seed_int(65536 * Math.random(), 16);
     }
}

function rng_get_byte() {
    if(rng_state == null) {
        if (rng_pool.length != rng_psize)
            throw 'RNG Pool length does not match pool size';

        if (rng_pool.filter(function(v) { return Math.abs(v) == 0; }).length > 12) {
            throw 'RNG Pool contains a large number of zero elements'
        }

        rng_seed_time();
        rng_state = prng_newstate();
        rng_state.init(rng_pool);
        for(rng_pptr = 0; rng_pptr < rng_pool.length; ++rng_pptr)
            rng_pool[rng_pptr] = 0;
        rng_pptr = 0;
        //rng_pool = null;
    }
    // TODO: allow reseeding after first request
    return rng_state.next();
}

function rng_get_bytes(ba) {
    var i;
    for(i = 0; i < ba.length; ++i) ba[i] = rng_get_byte();
}

function SecureRandom() {}

SecureRandom.prototype.nextBytes = rng_get_bytes;
