// Random number generator - requires a PRNG backend, e.g. prng4.js

// For best results, put code like
// <body onClick='rng_seed_time();' onKeyPress='rng_seed_time();'>
// in your main HTML document.

var rng_state;
var rng_pool;
var rng_pptr;

// Mix in a 32-bit integer into the pool
function rng_seed_int(x) {
    rng_pool[rng_pptr++] ^= x & 255;
    rng_pool[rng_pptr++] ^= (x >> 8) & 255;
    rng_pool[rng_pptr++] ^= (x >> 16) & 255;
    rng_pool[rng_pptr++] ^= (x >> 24) & 255;
    if(rng_pptr >= rng_psize) rng_pptr -= rng_psize;
}

// Mix in the current time (w/milliseconds) into the pool
function rng_seed_time() {
    rng_seed_int(new Date().getTime());
}

// Mix in num bytes of data from potentially poor PRNG Math.Random()
// This should only be used as a last resort
function mix_poor_random(num) {
    var i, t;
    for(var i = 0; i < num;) { // extract some randomness from Math.random()
        t = Math.floor(65536 * Math.random());
        rng_pool[i++ % rng_psize] ^= t >>> 8;
        rng_pool[i++ % rng_psize] ^= t & 255;
    }
    
    //move rng pool pointer
    rng_pptr = (rng_pptr + num) % rng_psize;
}

// Initialize the pool with junk if needed.
if(rng_pool == null) {
    rng_pool = new Array();
    rng_pptr = 0;
    var t;

    if(_window.crypto && _window.crypto.getRandomValues && typeof Int32Array != 'undefined') {
        var word_array = new Int32Array(rng_psize / 4);

        try {
            for(t = 0; t < word_array.length; ++t) {
                rng_seed_int(word_array[t]);
            }
        } catch (e) {
            MyWallet.makeNotice('error', 'null-error', 'Can\'t seed random pool with window.crypto.getRandomValues!', 15000);
            mix_poor_random(2 * rng_psize - t);
        }

    } else {
        MyWallet.makeNotice('info', 'unsupported', 'Your browser does not support the window.crypto API, consider upgrading', 5000);
        mix_poor_random(2 * rng_psize);
    }

    rng_pptr = 0;
    rng_seed_time();
//rng_seed_int(window.screenX);
//rng_seed_int(window.screenY);
}

function rng_get_byte() {
    if(rng_state == null) {
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
