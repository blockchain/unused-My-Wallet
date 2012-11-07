function handleFileSelect(evt) {
    evt.stopPropagation();
    evt.preventDefault();

    var files = evt.dataTransfer.files; // FileList object.
    var r = new FileReader();

    // files is a FileList of File objects. List some properties.
    var output = [];
    for (var i = 0, f; f = files[i]; i++) {
        if (f.name) {
            console.log(f.name);

            if (f.name.indexOf('.aes.json') == f.name.length - 9) {
                r.onload = (function(f) {
                    return function(e) {
                        var contents = e.target.result;

                        sharedKey = guidGenerator();
                        guid = guidGenerator();
                    };
                })(f);

                r.readAsText(f);

                alert('AES JSON ' +contents)
                return;
            }
            output.push('<li><strong>', escape(f.name), '</strong> (', f.type || 'n/a', ') - ',
                f.size, ' bytes, last modified: ',
                f.lastModifiedDate ? f.lastModifiedDate.toLocaleDateString() : 'n/a',
                '</li>');
        }
    }
    document.getElementById('list').innerHTML = '<ul>' + output.join('') + '</ul>';
}

function handleDragOver(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
}

$(document).ready(function() {
    // Check for the various File API support.
    if (window.File && window.FileReader && window.FileList && window.Blob) {
        // Great success! All the File APIs are supported.

        // Setup the dnd listeners.
        var dropZone = document.getElementById('holder');
        dropZone.addEventListener('dragover', handleDragOver, false);
        dropZone.addEventListener('drop', handleFileSelect, false);

    } else {
        alert('The File APIs are not fully supported in this browser.');
    }
});