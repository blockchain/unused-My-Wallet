var gCtx = null;
var gCanvas = null;
var imageData = null;
var c=0;
var stype=0;

function makeFlash(path)	{
	return $('<embed style="z-index:10;" allowScriptAccess="always" id="embedflash" src="'+path+'camcanvas.swf" quality="high" width="1" height="1" type="application/x-shockwave-flash" pluginspage="http://www.macromedia.com/go/getflashplayer" mayscript="true"  />');
}


function makeCanvas() {
	return $('<canvas style="z-index:-1;width: 800px; height: 600px; display:none;" id="qr-canvas" width="800" height="600"></canvas>');
}

function initCanvas(ww,hh)
{
    gCanvas = document.getElementById("qr-canvas");
    var w = ww;
    var h = hh;
    gCanvas.style.width = w + "px";
    gCanvas.style.height = h + "px";
    gCanvas.width = w;
    gCanvas.height = h;
    gCtx = gCanvas.getContext("2d");
    gCtx.clearRect(0, 0, w, h);
    imageData = gCtx.getImageData( 0,0,320,240);
}

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
        
        setTimeout(captureToCanvas, 1000);
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
		
		if ($("#embedflash").is(':visible')) {
			setTimeout(captureToCanvas, 1000);
		}
	}
}
 

function isCanvasSupported(){
  var elem = document.createElement('canvas');
  return !!(elem.getContext && elem.getContext('2d'));
}

function initQRFlash(el, path) {    
    $('#'+el).append(makeFlash(path));

    $("#embedflash").width(320).height(240);
    
    $('#'+el).append(makeCanvas());
	
    initCanvas(800,600);
}

function initQRCodeReader(el, callback, path)
{
	if(isCanvasSupported()) {
		
	   $("#embedflash").remove();
	   $("#qr-canvas").remove();
		 
       initQRFlash(el, path);
        
       qrcode.callback = callback;
        
       return setTimeout(captureToCanvas, 1000);
	} else {
	    $('#'+el).append('<p id="qr-canvas">Sorry your browser is not supported. Please try Firefox, Chrome or safari.</p>');
	}
}
