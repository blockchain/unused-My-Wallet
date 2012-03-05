$(document).ready(function() {	
	
	try {
		$('.slidedeck').slidedeck();
	
		//Popovers! 
		$(function () {
		 $("a[rel=popover]")
		   .popover({
		     offset: 10
		   })
		   .click(function(e) {
		     e.preventDefault()
		   });
		});
	} catch(err) {}
	
	//Uservoice
	setTimeout(function() {
		$('head').append('<script type="text/javascript" src="https://widget.uservoice.com/4wr7K1dKGPbvxshWQTrTg.js"></script>');		
	}, 10);
});