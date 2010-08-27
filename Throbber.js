/**
 *   Throbber
 * ============
 * A circular, indeterminate progress indicator with alpha-transparency.
 *
 * @param attachPt [optional] (Node) - a node that this Throbber will replace
 *		in the document tree once constructed. If not specified on construction, the Throbber will
 *		not be visible or able to animate until the attach() method is called.
 * @param configuration [optional] (Object)- a hash-map of optional configuration parameters.
 *		All parameters are public members of this class, and may be changed individually or
 *		as a group (by setting .configuration) after construction.
 *		Available parameters:
 *			• spokes (+integer) default=9
 *				the number of spokes in the Throbber wheel
 *			• spokeWidth (+number) default=2
 *				width (in CSS pixels) of the paint stroke along each spoke
 *			• spokeColor (string) default="#FFF"
 *				CSS color of the paint stroke along each spoke
 *			• spokeLength (+number) default=5
 *				length of each spoke in CSS pixels
 *			• spokeOutset (+number) default=6
 *				inner (empty) radius of the throbber in CSS pixels
 *			• style (string) default="wave"
 *				animation style (one of "wave", "trail", "pan", or "sparkle")
 *			• styleVariant (+integer) default: 0
 *				a style-specific parameter
 *			• clockwise (boolean) default=true
 *				animation cycle direction (true = clockwise, false = counter-clockwise)
 *			• period (+number|string) default=1.5
 *				time to complete one animation cycle, in seconds.  Alternately, one of the
 *				following keywords: "normal" (equivalent to 1.5s), "short" (0.5s), or "long" (2.5s)
 *			• fps (+number|string) default=15
 *				maximum frames-per-second of the animation, or the keyword "auto" which will
 *				use a value suitable for the animation period.
 *			• autostart (boolean) default=true
 *				whether or not to start the animation immediately after attaching
 */
function Throbber(attachPt, configuration) {
	// constants
	var errHeader = "Throbber: ";
	var contructorErrHeader = "Throbber [constructor]: ";
	var errHeaderRegex = /^Throbber:/;
	var className = "Throbber";
	var max_fps = 1000;   // let's not get too crazy
	var max_frames = 100; // unlikely to have more levels of opacity than this
	var default_fps = 15; // good enough for smooth animation in most cases
	var short_frames = 5; // use this many frames for short (<0.3s) animations


	// configuration parameters (may be given in the configuration argument)
	var config = {
		spokes: 9,			// number of spokes
		spokeWidth: 2,		// width of each spoke
		spokeColor: "#FFF",	// CSS color
		spokeLength: 5,		// length of each spoke
		spokeOutset: 6,		// distance spokes are offset out from the center of the throbber
		style: "wave",		// animation style
		styleVariant: 0,	// style-specific parameter
		clockwise: true,	// animation cycle direction (true = clockwise, false = counter-clockwise)
		period: 1.5,		// time to complete one animation cycle
		fps: default_fps,	// maximum frames-per-second of animation
		autostart: true		// whether or not to start the animation immediately after attaching
	};

	// private vars
	var container;			// wraps the canvas; user styles may be attached to this
	var canvas;				// the canvas element used for drawing
	var ctx;				// the 2d context of the canvas
	var attached = false;	// whether or not the Throbber is currently attached
	var explicitFps = false;	// whether or not fps was set explicitly by the user
	var delay;				// 1000÷fps (milliseconds)
	var frame = 0;			// current animation frame
	var totalFrames;		// total number of frames in the animation
	var timer = null;		// setInterval timer for draw() calls
	var start;				// time in ms that animation started
	var insertionPt;		// last-used attachment node
	var that = this;		// alias to current object, to get around scoping bugs


// #######################
//     PUBLIC METHODS
// #######################

	/**
	 *  Inserts the Throbber into the document.
	 *	If autostart was previously set to true (or the default used), it will begin playing
	 * immediately after insertion.
	 *
	 * @param attachHere a node within the document tree which will be replaced by the Throbber
	 *		if not given, the most recently used attachment node will be reused.
	 * @returns the replaced node
	 * @throws if a valid attachment node is not found, or if a DOM error occurs
	 */
	this.attach = function(attachHere) {
		if (attached) {
			throw (errHeader+"already attached. Call detach() first.");
		}
		
		// figure out where to attach
		if (attachHere instanceof Node) {  // given
			insertionPt = attachHere;
		} else if (attachPt instanceof Node) {  // memorized
			insertionPt = attachPt;
		} else {
			throw (errHeader+"invalid/missing attach point (must be a DOM node in the document tree).");
		}
		// overwrite attachPt to remember this choice for next time
		attachPt = insertionPt;
		
		// check that the insertionPt is actually in the document tree
		var current = insertionPt.parentNode;
		while (current !== document) {
			if (current.parentNode === null) { // not in the tree!
				// forget the attach point
				attachPt = null; insertionPt = null;
				throw (errHeader+"attach point is not in the document tree.");
			} else {
				current = current.parentNode;
			}
		}
		
		// all's good, go ahead and replace the attach point with the Throbber
		try {
			var insertionDest = insertionPt.parentNode;
			insertionDest.replaceChild(container, insertionPt);
			insertionDest.addEventListener("DOMNodeRemoved", handleForcedDetach);
			attached = true;
			reconfigure();
			if (config.autostart) {
				// start ASAP after returning
				setTimeout(function() { that.start(); }, 1);
			}
		} catch (e) {
			throw (errHeader+"DOM error while attaching - "+e);
		}

		return insertionPt;
	};
	
	/**
	 * Removes the Throbber from the document, replacing it with the attachment node that
	 * was previously removed by attach().
	 *
	 * @returns the reinserted attachment node
	 * @throws if a DOM error occurs
	 */
	this.detach = function() {
		if (!attached) {
			console.warn(errHeader+"detach() called on Throbber which is not currently attached.", that);
			return null;
		} else {
			// if currently playing, stop first
			if (timer) { that.stop(); }
			try {
				container.parentNode.removeEventListener("DOMNodeRemoved", handleForcedDetach);
				container.parentNode.replaceChild(insertionPt, container);
				attached = false;
				var oldInsertionPt = insertionPt;
				insertionPt = null;
				return oldInsertionPt;
			} catch (e) {
				throw (errHeader+"DOM error while detaching - "+e);
			}
		}
	};
	
	/**
	 * Starts the animation.  If the Throbber is currently detached, it will first be re-attached
	 * at the last-used attachment node.
	 *
	 * @throws if the Throbber was detached and could not be attached.
	 */
	this.start = function() {
		if (timer === null) {
			if (!attached) {
				var autostart_bu = config.autostart;
				config.autostart = false;
				try {
					that.attach(insertionPt);
				} catch (e) {
					throw (errHeader+"not yet attached and invalid/missing attach point (must be a DOM node).");
				}
				config.autostart = autostart_bu;
			} else {
				reconfigure();
			}
			if (start === undefined) { start = new Date(); }
			else { // resuming after a pause
				setStartTimeFromFrame();
			}
			timer = setInterval(draw, delay);
		} else {
			console.log(errHeader+"attempted to start animation of a Throbber that is already animating.",that);
		}
	};
	this.animate = that.start;
	this.play = that.start;
	this.resume = that.start;

	/**
	 * Pauses the animation.
	 */
	this.stop = function() {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		} else {
			console.warn(errHeader+"attempted to stop animation of a Throbber that isn't animating.",that);
		}
	};
	this.pause = that.stop;


// #######################
//    GETTERS & SETTERS
// #######################

	this.__defineSetter__("spokes", function (val) {
		var tmp = parseFloat(val.valueOf());
		if (isNaN(tmp) || tmp <= 1) {
			throw (errHeader+"'spokes' must be an integer greater than 1 (got "+val.valueOf()+").");
		} else {
			config.spokes = Math.floor(tmp);
			reconfigure();
			return config.spokes;
		}
	});
	this.__defineSetter__("spokeWidth", function (val) {
		var tmp = parseFloat(val.valueOf());
		if (isNaN(tmp) || tmp <= 0) {
			throw (errHeader+"'spokeWidth' must be a positive number (got "+val.valueOf()+").");
		} else {
			config.spokeWidth = tmp;
			reconfigure();
			return config.spokeWidth;
		}
	});
	this.__defineSetter__("spokeColor", function (val) {
		var tester = document.createElement("div");
		tester.style.color = val.toString();
		if (tester.style.color === "") { // style won't "stick" if it was invalid // CHECK: browser compat?
			throw (errHeader+"'spokeColor' must be a valid CSS color (got "+val.valueOf()+").");
		} else {
			config.spokeColor = val.toString();
			reconfigure();
			return config.spokeColor;
		}

	});
	this.__defineSetter__("spokeLength", function (val) {
		var tmp = parseFloat(val.valueOf());
		if (isNaN(tmp) || tmp <= 0) {
			throw (errHeader+"'spokeLength' must be a positive number (got "+val.valueOf()+").");
		} else {
			config.spokeLength = tmp;
			reconfigure();
			return config.spokeLength;
		}
	}); 
	this.__defineSetter__("spokeOutset", function (val) {
		var tmp = parseFloat(val.valueOf());
		if (isNaN(tmp) || tmp <= 0) {
			throw (errHeader+"'spokeOutset' must be a positive number (got "+val.valueOf()+").");
		} else {
			config.spokeOutset = tmp;
			reconfigure();
			return config.spokeOutset;
		}
	}); 
	this.__defineSetter__("style", function (val) {
		var tmp = val.valueOf();
		if (
			tmp !== "trail" &&
			tmp !== "wave" &&
			tmp !== "pan" &&
			tmp !== "sparkle"
		) {
			throw (errHeader+"animation style '"+tmp+"' is not recognized.");
		} else {
			config.style = tmp;
			// note: reconfigure call not needed for this parameter
			return config.style;
		}
	});
	this.__defineSetter__("styleVariant", function (val) {
		var tmp = parseInt(val.valueOf());
		if (isNaN(tmp) || tmp < 0) {
			throw (errHeader+"'styleVariant' must be a non-negative integer (got "+val.valueOf()+").");
		} else {
			config.styleVariant = tmp;
		}
		// note: reconfigure call not needed for this parameter
		return config.styleVariant;
	});
	this.__defineSetter__("clockwise", function (val) {
		if (val != config.clockwise) {
			config.clockwise = !config.clockwise;
			setStartTimeFromFrame();
		}
		// note: reconfigure call not needed for this parameter
		return config.clockwise;
	});
	this.__defineSetter__("period", function (val) {
		if (typeof val.valueOf() === 'string') {
			switch (val.valueOf()) {
			case "short": val = 0.5; break;
			case "long": val = 2.5; break;
			case "normal": // default
			default: val = 1.5; break;
			}
		}
		var tmp = parseFloat(val.valueOf());
		if (isNaN(tmp) || tmp <= 0) {
			throw (errHeader+"'period' must be a positive number or keyword (got "+val.valueOf()+").");
		} else if (explicitFps && tmp < 2/config.fps) { // constrain only if fps explicitly set
			throw (
				errHeader+"'period' must be at least "+(2/config.fps).toFixed(2)+"s"+
				" to ensure at least 2 frames of animation (got "+val.valueOf()+")."
			);
		} else if (tmp < 2/max_fps) {
			throw (
				errHeader+"'period' must be at least "+(2/max_fps).toFixed(2)+"s"+
				"to ensure at least 2 frames of animation (got "+val.valueOf()+")."
			);
		} else {
			config.period = tmp;
			if (!explicitFps) {
				// adjust fps as appropriate for period
				if (config.period < short_frames/default_fps) {
					// set a lower limit on the number of frames used for short periods
					config.fps = short_frames/config.period;
				} else if (config.period <= max_frames/default_fps) {
					// constant default_fps should be fine for most cases
					config.fps = default_fps;
				} else {
					// cap frames at max_frames
					config.fps = max_frames/config.period;
				}
			}
			// reconfigure is not enough, need to do a full restart to preserve animation state
			if (timer) {
				that.stop();
				that.start();
			}
			return config.period;
		}
	});
	this.__defineSetter__("fps", function (val) {
		var tmp = parseFloat(val.valueOf());
		if (val === "auto") {
			explicitFps = false;
			that.period = that.period; // trigger fps computation
			// reconfigure is not enough, need to do a full restart
			if (timer) {
				that.stop();
				that.start();
			}
			return config.fps;
		}
		if (isNaN(tmp) || tmp <= 0 || tmp > max_fps) {
			throw (
				errHeader+"'fps' must be a positive number less than "+max_fps+
				" (got "+val.valueOf()+")."
			);
		} else if (config.period*tmp < 2) {
			throw (
				errHeader+"'fps' must be greater than "+(2/config.period).toFixed(2)+
				" to ensure at least 2 frames of animation (got "+val.valueOf()+")."
			);
		} else {
			config.fps = tmp;
			explicitFps = true;
			// reconfigure is not enough, need to do a full restart
			if (timer) {
				that.stop();
				that.start();
			}
			return config.fps;
		}
	});
	this.__defineSetter__("autostart", function (val) {
		if (val != config.autostart) { config.autostart = !config.autostart; }
		// note: no reconfigure call necessary
		return config.autostart;
	});
	this.__defineSetter__("configuration", function (newConf) {
		var needRestart = false;
		if (newConf !== undefined) {
			// set these using standard setter methods
			var these = [
				"spokes", "spokeWidth", "spokeColor", "spokeLength",
				"spokeOutset", "style", "styleVariant", "clockwise", "autostart"
			];
			for (var i=0; i<these.length; i++) {
				if (newConf[these[i]] !== undefined) {
					try {
						that[these[i]] = newConf[these[i]];
					} catch (e) {
						console.warn(
							e.replace(errHeaderRegex, constructorErrHeader)+
							" Using default value ("+config[these[i]]+")."
						);
					}
				}
			}
			// fps and period need to be handled carefully when set at the same time
			if (newConf.fps !== undefined) {
				var val = parseFloat(newConf.fps.valueOf());
				if (!isNaN(val) && val > 0 && val <= max_fps) {
					config.fps = val;
					explicitFps = true;
					needRestart = true;
				} else if (newConf.fps === "auto") {
					explicitFps = false;
					that.period = that.period; // trigger fps computation
					needRestart = true;
				}
			}
			if (newConf.period !== undefined) {
				try {
					that.period = newConf.period;
					needRestart = true;
				} catch (e) {
					console.warn(
						e.replace(errHeaderRegex, constructorErrHeader)+
						" Using default value ("+config['period']+"s)."
					);
				}
			}
			if (!explicitFps && newConf.fps !== undefined && newConf.fps !== "auto") {
				throw (
					constructorErrHeader+"value of fps must be greater than 0 and less than 1000."+
					" Using default value ("+config.fps+")."
				);
			}
		}
		if (needRestart && timer) {
			that.stop(); that.start();
		} else {
			reconfigure();
		}
		return that.configuration; // (uses getter)
	});

	// define getters for all configuration params
	for (var prop in config) { if (config.hasOwnProperty(prop)) {
		this.__defineGetter__(prop, (function (p) { return function () { return config[p]; }; })(prop));
	}}
	// define a getter for the config object as a whole
	this.__defineGetter__("configuration", function () {
		return config.valueOf();
	});


// #######################
//    CONSTRUCTOR TASKS
// #######################

	// set config prefs given constructor call
	that.configuration = configuration;

	// create the canvas element and its container
	container = document.createElement("div");
	container.className = className;
	canvas = container.appendChild(document.createElement("canvas"));

	// make sure the canvas isn't styled in any way unexpected
	canvas.style.position = "static !important";
	canvas.style.display = "inline-block !important";
	canvas.style.margin = "0 !important";
	canvas.style.padding = "0 !important";
	canvas.style.backgroundColor = "transparent !important";
	canvas.style.backgroundImage = "none !important";
	canvas.style.borderWidth = "0 !important";
	canvas.style.borderRadius = "0 !important";

	if (config.autostart && attachPt !== undefined) {
		// start ASAP _after_ the object is returned (since start() may throw)
		setTimeout(function() { that.start(); }, 1);
	} else if (attachPt !== undefined) {
		// attach, but don't start
		that.attach(attachPt);
	}


// #####################
//    PRIVATE METHODS
// #####################

	// use: EventListener for "DOMNodeRemoved" while attached
	// ~~~~~~
	// The Throbber's container+canvas nodes may be removed from the document tree
	// by other means that the detach method (ie. document.removeChild in another script).
	// We need to detect if this is happening and properly detatch the nodes if possible
	// in order to avoid memory leaks and unnecessary processing time spent on painting.
	function handleForcedDetach(evt) {
		if (attached) {
			function containsMe(node) {
				if (node === container || node === canvas) {
					return true;
				} else if (node.children && node.children.length > 0) {
					for (var i=0; i<node.children.length; i++) {
						if (containsMe(node.children[i])) {
							return true;
						}
					}
					return false;
				} else {
					return false;
				}
			}
			if (containsMe(evt.target)) {
				if (timer) { that.stop(); }
				container.parentNode.removeEventListener("DOMNodeRemoved", handleForcedDetach);
				try {
					// in case it's the Throbber being forcefully removed,
					//  put the insertionPt element back
					container.parentNode.insertBefore(insertionPt, container);
					insertionPt = null;
				} catch (e) {
					// not much we can do about it at this point :(
				}
				container.parentNode.removeEventListener("DOMNodeRemoved", handleForcedDetach);
				attached = false;
				// note: don't actually need to remove container, since it's already going to happen
			}
		}
	}

	// use: called after config.clockwise change, or after resuming from pause
	// ~~~~~~
	// draw() chooses a frame based on the time elapsed since starting the animation in order
	// to allow frame-dropping when timer events are delayed.  However, this means calling stop()
	// does not actually stop the incrementing of frames.  Also, because frame numbers are
	// calculated differently for clockwise/counter-clockwise motion, switching from one to the
	// other direction may cause an ugly jump in the animation.  To solve both these issues,
	// this function simply resets the "start" time of the animation to a value that would
	// yeild the correct frame number if draw() is called immediately afterward.
	function setStartTimeFromFrame() {
		if (start) { // no problem if we haven't started yet
			if (config.clockwise) {
				start = (new Date()) - delay*frame;
			} else {
				start = (new Date()) - delay*(totalFrames-1 - frame);
			}
		}
	}

	// use: called after most configuration variables are changed
	// ~~~~~~
	// Users may update the config variables at any time. The canvas size, graphic style,
	// number of animation frames, and frame delay all have values that are calculated from these
	// configuration variables, and so must be refreshed any time the config changes.
	function reconfigure() {
		if (attached) {
			canvas.height = (config.spokeOutset+config.spokeLength)*2 + config.spokeWidth;
			canvas.width = canvas.height;
			ctx = canvas.getContext("2d");
			ctx.strokeStyle = config.spokeColor;
			ctx.lineWidth = config.spokeWidth;
			ctx.lineCap = "square";
			
			delay = 1000/config.fps;
			totalFrames = config.period*config.fps;
			
			draw(); // update immediately (even if stopped)
		}
	}

	// use: called just before every drawing step
	// ~~~~~~
	// The animation effect is produced by varing the opacity of drawn elements in a pattern
	// determined by the animation type and the frame number.  This function sets the opacity
	// to the appropriate value for the given frame.
	function setAlpha(curFrame) {
		switch (config.style) {
		case "trail":
			// styleVariant controls number of trail headers
			ctx.globalAlpha = Math.pow(
				(curFrame % (totalFrames/(config.styleVariant+1))) / (totalFrames/(config.styleVariant+1) - 1),
				2
			);
			break;
		case "pan":
			// styleVariant controls number + size of wedges
			if (config.styleVariant === 0) {
				ctx.globalAlpha = (curFrame < totalFrames/2 ? 1 : 0);
			} else if (config.styleVariant === 1) {
				ctx.globalAlpha = (curFrame < totalFrames/3 ? 1 : 0);
			} else if (config.styleVariant >= 2) {
				var wedges = (config.styleVariant)*2;
				if ((wedges*curFrame/totalFrames) % 2 < 1) {
					ctx.globalAlpha = 1;
				} else {
					ctx.globalAlpha = 0;
				}
			}
			break;
		case "sparkle":
			// styleVariant gives different sparkle patterns
			var rand = Math.random();
			if (config.styleVariant === 0) {
				// totally random
				ctx.globalAlpha = rand;
			} else if (config.styleVariant === 1) {
				// only on or off, no shades. slight weighting towards off.
				if (rand < 0.6) { ctx.globalAlpha = 0; }
				else { ctx.globalAlpha = 1; }
			} else if (config.styleVariant === 2) {
				// dark with infrequent bright flashes
				if (rand < 0.5) { ctx.globalAlpha = 0; }
				else if (rand < 0.8) { ctx.globalAlpha = 0.1; }
				else if (rand < 0.85) { ctx.globalAlpha = 0.2; }
				else if (rand < 0.9) { ctx.globalAlpha = 0.3; }
				else if (rand < 0.95) { ctx.globalAlpha = 0.4; }
				else if (rand < 0.98) { ctx.globalAlpha = 0.5; }
				else { ctx.globalAlpha = 1; }
			} else if (config.styleVariant === 3){
				// random with more weight to lower opacities
				if (rand < 0.3) { ctx.globalAlpha = 0; }
				else if (rand < 0.9) { ctx.globalAlpha = rand-0.3; }
				else { ctx.globalAlpha = 1; }
			} else {
				// random everything, including color!
				ctx.globalAlpha = rand;
				ctx.strokeStyle = "rgb("+
					Math.floor(Math.random()*255)+","+
					Math.floor(Math.random()*255)+","+
					Math.floor(Math.random()*255)+
				")";
			}
			break;
		case "wave":
			// default case
		default:
			// styleVariant controls order of exponential curve
			var power, comp;
			if (config.styleVariant === 0) { power = 2.3; } // think of 0 as "default"
			else { power = config.styleVariant; }
			if  (curFrame < totalFrames/2) {
				comp = Math.pow(2*curFrame/totalFrames, power);
			} else {
				comp = Math.pow(2*(totalFrames-curFrame)/totalFrames, power);
			}
			ctx.globalAlpha = comp;
			break;
		}
	}

	// use: draws a single frame of the Throbber animation
	// ~~~~~~
	// reconfigure must be called at some point before calling this function.
	// Although the frame number is used to animate the Throbber as a whole, each spoke
	// actually gets its own framenumber to use that is equally spaced from all the other spokes
	// within the available frames.  It is this spacing of frames that ultimately creates
	// the illusion of rotation.
	function draw() {
		if (timer) { // animating
			var now = new Date();
			if (config.clockwise) {
				frame = ((now - start) / delay) % totalFrames;
			} else {
				// counting backwards
				frame = (((start - now) / delay) % totalFrames) + totalFrames;
			}
		}
		ctx.save();
		ctx.clearRect(0,0,canvas.width,canvas.height);
		ctx.translate(canvas.width/2, canvas.height/2);
		for (var i=0; i<config.spokes; i++) {
			setAlpha(frame);
			ctx.beginPath();
			ctx.moveTo(0, config.spokeOutset);
			ctx.lineTo(0, config.spokeOutset+config.spokeLength);
			ctx.stroke();
			ctx.rotate(-2*Math.PI/config.spokes);
			frame = (frame + totalFrames/config.spokes) % totalFrames;
		}
		ctx.restore();
	}
}
