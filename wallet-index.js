$(document).ready(function() {	
	
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
});