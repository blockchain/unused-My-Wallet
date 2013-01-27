var gCtx = null;
var gCanvas = null;
var imageData = null;
var c=0;

//Called by the flash QR Scanner
function passLine(stringPixels) {
    var coll = stringPixels.split("-");

    for(var i=0;i<320;i++) {
        var intVal = parseInt(coll[i]);
        r = (intVal >> 16) & 0xff;
        g = (intVal >> 8) & 0xff;
        b = (intVal ) & 0xff;
        imageData.data[c+0]=r;
        imageData.data[c+1]=g;
        imageData.data[c+2]=b;
        imageData.data[c+3]=255;
        c+=4;
    }

    if(c>=320*240*4) {
        c=0;
        gCtx.putImageData(imageData, 0,0);

        try{
            qrcode.decode();
        } catch(e){ };
    }
}

function captureToCanvas() {
    try {
        flash = document.getElementById("embedflash");

        if(!flash)
            return;

        flash.ccCapture();
    } catch (e) {
        console.log(e);
    }
}

var QRCodeReader = {
    video:'',
    container:'',
    canvas:'',
    ctx:'',
    out:'',
    found:false,
    timer:'',

    isCanvasSupported : function(){
        var elem = document.createElement('canvas');
        return !!(elem.getContext && elem.getContext('2d'));
    },

    loop: function() {
        QRCodeReader.captureToCanvas();
    },

    captureToCanvas: function() {
        QRCodeReader.ctx.drawImage(QRCodeReader.video, 0, 0, QRCodeReader.video.videoWidth, QRCodeReader.video.videoHeight, 0, 0, QRCodeReader.canvas.width, QRCodeReader.canvas.height);

        qrcode.decode(QRCodeReader.canvas.toDataURL());
    },

    canvasInit: function() {
        QRCodeReader.canvas = document.createElement('canvas');
        QRCodeReader.canvas.width = QRCodeReader.video.videoWidth;
        QRCodeReader.canvas.height = QRCodeReader.video.videoHeight;
        QRCodeReader.ctx = QRCodeReader.canvas.getContext('2d');
        QRCodeReader.interval = setInterval(QRCodeReader.loop, 500);
    },

    stop : function() {
        if (QRCodeReader.interval) {
            clearInterval(QRCodeReader.interval);
            QRCodeReader.interval = null;
        }

        if (QRCodeReader.reader_container) {
            QRCodeReader.reader_container.empty();
            QRCodeReader.reader_container = null;
        }
    },

    //Pass in Jquery Obj
    init: function(el, success, error) {

        if (!QRCodeReader.isCanvasSupported())  {
            error('Sorry your browser does not support canvas. Please try Firefox, Chrome or safari.');
            return;
        }

        var hasFlash = false;
        try {
            var fo = new ActiveXObject('ShockwaveFlash.ShockwaveFlash');
            if(fo) hasFlash = true;
        } catch(e){
            if(navigator.mimeTypes ["application/x-shockwave-flash"] != undefined) hasFlash = true;
        }

        loadScript('wallet/llqrcode.js', function() {

            // Standard and prefixed methods for hooking into stream
            navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.msGetUserMedia;
            window.URL = window.URL || window.webkitURL || window.mozURL || window.msURL;

            QRCodeReader.reader_container = el.find('.qr-code-reader');

            if (navigator.getUserMedia) {
                //Append the video element
                QRCodeReader.reader_container.html('<video style="width:320px;height:240px" autoplay id="sourcevid"></video>');

                QRCodeReader.video = QRCodeReader.reader_container.find('video').get(0);

                QRCodeReader.flash = null;

                navigator.getUserMedia({video: true}, function(stream) {

                    QRCodeReader.video.src = window.URL.createObjectURL(stream) || stream;

                    setTimeout(QRCodeReader.canvasInit,250); // Needed to get videoWidth/videoHeight
                }, error);

            } else if (hasFlash) {

                function initCanvas(ww,hh) {
                    gCanvas = document.getElementById("qr-canvas");
                    var w = ww;
                    var h = hh;
                    gCanvas.style.width = w + "px";
                    gCanvas.style.height = h + "px";
                    gCanvas.width = w;
                    gCanvas.height = h;
                    gCtx = gCanvas.getContext("2d");
                    gCtx.clearRect(0, 0, w, h);
                    imageData = gCtx.getImageData(0,0,320,240);
                }

                function makeFlash(path)	{
                    return $('<embed style="z-index:10;" allowScriptAccess="always" id="embedflash" src="'+path+'camcanvas.swf" quality="high" width="1" height="1" type="application/x-shockwave-flash" pluginspage="http://www.macromedia.com/go/getflashplayer" mayscript="true"  />');
                }

                function makeCanvas() {
                    return $('<canvas style="z-index:-1;width:800px;height:600px; display:none;" id="qr-canvas" width="800" height="600"></canvas>');
                }

                QRCodeReader.reader_container.html(makeFlash(resource + 'wallet/').width(320).height(240));

                QRCodeReader.reader_container.append(makeCanvas());

                initCanvas(800,600);

                QRCodeReader.interval = setInterval(captureToCanvas, 1000);
            } else {
                error('Sorry your browser is not supported. Please try Firefox, Chrome or safari.');
            }

            qrcode.callback = function(data) { if (data) { QRCodeReader.stop(); success(data) } };
        });
    }
};
