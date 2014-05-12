/*
 * The copyright in this software is being made available under the BSD License, included below. This software may be subject to other third party and contributor rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Digital Primates
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * •  Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * •  Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * •  Neither the name of the Digital Primates nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
MediaPlayer.dependencies.BufferController = function () {
    "use strict";
    var STALL_THRESHOLD = 0.5,
        QUOTA_EXCEEDED_ERROR_CODE = 22,
        initializationData = [],
        seekTarget = -1,
        lastQuality = 0,
        isBufferingCompleted = false,
        deferredAppends = [],
        deferredInitAppend = null,
        deferredStreamComplete = Q.defer(),
        deferredRejectedDataAppend = null,
        deferredBuffersFlatten = null,
        bufferLevel = 0,
        isQuotaExceeded = false,
        rejectedBytes = null,
        appendingRejectedData = false,
        mediaSource,
        maxAppendedIndex = -1,
        lastIndex = -1,
        type,
        buffer = null,
        minBufferTime,
        hasSufficientBuffer = null,

        onInitializationLoaded = function(sender, model, bytes, quality) {
            var self = this;

            if (model !== self.streamProcessor.getFragmentModel()) return;

            self.debug.log("Initialization finished loading: " + type);

            // cache the initialization data to use it next time the quality has changed
            initializationData[quality] = bytes;

            // if this is the initialization data for current quality we need to push it to the buffer
            if (quality === lastQuality) {
                appendToBuffer.call(self, bytes, quality).then(
                    function() {
                        deferredInitAppend.resolve();
                    }
                );
            }
        },

		onMediaLoaded = function (sender, model, bytes, quality, index) {
			var self = this;

            if ((model !== self.streamProcessor.getFragmentModel()) || (deferredInitAppend === null)) return;

			//self.debug.log(type + " Bytes finished loading: " + request.streamType + ":" + request.startTime);

            Q.when(deferredInitAppend.promise).then(
                function() {
                    appendToBuffer.call(self, bytes, quality, index).then(
                        function() {
                            maxAppendedIndex = (index > maxAppendedIndex) ? index : maxAppendedIndex;
                            checkIfBufferingCompleted.call(self);
                        }
                    );
                }
            );
		},

        appendToBuffer = function(data, quality, index) {
            var self = this,
                isAppendingRejectedData = (data == rejectedBytes),
                // if we append the rejected data we should use the stored promise instead of creating a new one
                deferred = isAppendingRejectedData ? deferredRejectedDataAppend : Q.defer(),
                ln = isAppendingRejectedData ? deferredAppends.length : deferredAppends.push(deferred),
                ranges;

            //self.debug.log("Push (" + type + ") bytes: " + data.byteLength);

            Q.when((isAppendingRejectedData) || ln < 2 || deferredAppends[ln - 2].promise).then(
                function() {
                    if (!hasData.call(self)) return;
                    hasEnoughSpaceToAppend.call(self).then(
                        function() {
                            if (quality !== lastQuality) {
                                deferred.resolve();
                                if (isAppendingRejectedData) {
                                    deferredRejectedDataAppend = null;
                                    rejectedBytes = null;
                                }
                                return;
                            }

                            Q.when(deferredBuffersFlatten ? deferredBuffersFlatten.promise : true).then(
                                function() {
                                    if (!hasData.call(self)) return;
                                    self.sourceBufferExt.append(buffer, data).then(
                                        function (/*appended*/) {
                                            if (isAppendingRejectedData) {
                                                deferredRejectedDataAppend = null;
                                                rejectedBytes = null;
                                            }

                                            isQuotaExceeded = false;

                                            if (!hasData.call(self)) return;

                                            if (updateBufferLevel.call(self)) {
                                                self.notify(self.eventList.ENAME_BYTES_APPENDED, index);
                                                deferred.resolve();
                                            }

                                            ranges = self.sourceBufferExt.getAllRanges(buffer);

                                            if (ranges) {
                                                //self.debug.log("Append " + type + " complete: " + ranges.length);
                                                if (ranges.length > 0) {
                                                    var i,
                                                        len;

                                                    //self.debug.log("Number of buffered " + type + " ranges: " + ranges.length);
                                                    for (i = 0, len = ranges.length; i < len; i += 1) {
                                                        self.debug.log("Buffered " + type + " Range: " + ranges.start(i) + " - " + ranges.end(i));
                                                    }
                                                }
                                            }
                                        },
                                        function(result) {
                                            // if the append has failed because the buffer is full we should store the data
                                            // that has not been appended and stop request scheduling. We also need to store
                                            // the promise for this append because the next data can be appended only after
                                            // this promise is resolved.
                                            if (result.err.code === QUOTA_EXCEEDED_ERROR_CODE) {
                                                rejectedBytes = data;
                                                deferredRejectedDataAppend = deferred;
                                                isQuotaExceeded = true;
                                                self.notify(self.eventList.ENAME_QUOTA_EXCEEDED, index);
                                            }
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );

            return deferred.promise;
        },

        updateBufferLevel = function() {
            if (!hasData.call(this)) return false;

            var self = this,
                currentTime = self.playbackController.getTime(),
                bufferLength;

            bufferLength = self.sourceBufferExt.getBufferLength(buffer, currentTime);

            if (!hasData.call(self)) {
                return false;
            }

            bufferLevel = bufferLength;
            self.notify(self.eventList.ENAME_BUFFER_LEVEL_UPDATED, bufferLevel);
            checkGapBetweenBuffers.call(self);
            checkIfSufficientBuffer.call(self);

            if (bufferLevel < STALL_THRESHOLD) {
                notifyIfSufficientBufferStateChanged.call(self, false);
            }

            return true;
        },

        checkGapBetweenBuffers= function() {
            var leastLevel = this.bufferExt.getLeastBufferLevel(),
                acceptableGap = minBufferTime * 2,
                actualGap = bufferLevel - leastLevel;

            // if the gap betweeen buffers is too big we should create a promise that prevents appending data to the current
            // buffer and requesting new segments until the gap will be reduced to the suitable size.
            if (actualGap > acceptableGap && !deferredBuffersFlatten) {
                deferredBuffersFlatten = Q.defer();
                this.notify(this.eventList.ENAME_BUFFER_LEVEL_OUTRUN);
            } else if ((actualGap < acceptableGap) && deferredBuffersFlatten) {
                deferredBuffersFlatten.resolve();
                deferredBuffersFlatten = null;
                this.notify(this.eventList.ENAME_BUFFER_LEVEL_BALANCED);
            }
        },

        hasEnoughSpaceToAppend = function() {
            var self = this,
                deferred = Q.defer(),
                removedTime = 0,
                startClearing;

            // do not remove any data until the quota is exceeded
            if (!isQuotaExceeded) {
                return Q.when(true);
            }

            startClearing = function() {
                clearBuffer.call(self).then(
                    function(removedTimeValue) {
                        removedTime += removedTimeValue;
                        if (removedTime >= minBufferTime) {
                            deferred.resolve();
                        } else {
                            setTimeout(startClearing, minBufferTime * 1000);
                        }
                    }
                );
            };

            startClearing.call(self);

            return deferred.promise;
        },

        clearBuffer = function() {
            var self = this,
                deferred = Q.defer(),
                currentTime = self.playbackController.getTime(),
                removeStart = 0,
                removeEnd,
                range,
                req;

            // we need to remove data that is more than one segment before the video currentTime
            req = self.fragmentController.getExecutedRequestForTime(self.streamProcessor.getFragmentModel(), currentTime);
            removeEnd = (req && !isNaN(req.startTime)) ? req.startTime : Math.floor(currentTime);

            range = self.sourceBufferExt.getBufferRange(buffer, currentTime);

            if ((range === null) && (seekTarget === currentTime) && (buffer.buffered.length > 0)) {
                removeEnd = buffer.buffered.end(buffer.buffered.length -1 );
            }
            removeStart = buffer.buffered.start(0);
            self.sourceBufferExt.remove(buffer, removeStart, removeEnd, mediaSource).then(
                function() {
                    self.notify(self.eventList.ENAME_BUFFER_CLEARED, removeStart, removeEnd);
                    deferred.resolve(removeEnd - removeStart);
                }
            );

            return deferred.promise;
        },

        checkIfBufferingCompleted = function() {
            var isLastIdxAppended = maxAppendedIndex === (lastIndex - 1);

            if (!isLastIdxAppended || isBufferingCompleted) return;

            isBufferingCompleted = true;
            this.notify(this.eventList.ENAME_BUFFERING_COMPLETED);
        },

        checkIfSufficientBuffer = function () {
            var timeToEnd = this.playbackController.getTimeToPeriodEnd();

            if ((bufferLevel < minBufferTime) && ((minBufferTime < timeToEnd) || (minBufferTime >= timeToEnd && !isBufferingCompleted))) {
                notifyIfSufficientBufferStateChanged.call(this, false);
            } else {
                notifyIfSufficientBufferStateChanged.call(this, true);
            }
        },

        notifyIfSufficientBufferStateChanged = function(state) {
            if (hasSufficientBuffer === state) return;

            hasSufficientBuffer = state;

            this.debug.log(hasSufficientBuffer ? ("Got enough " + type + " buffer to start.") : ("Waiting for more " + type + " buffer before starting playback."));
            this.notify(this.eventList.ENAME_BUFFER_LEVEL_STATE_CHANGED, state);
        },

        hasData = function() {
            return !!this.representationController && !!this.representationController.getData() && !!buffer;
        },

        updateBufferTimestampOffset = function(MSETimeOffset) {
            // each representation can have its own @presentationTimeOffset, so we should set the offset
            // if it has changed after switching the quality or updating an mpd
            if (buffer.timestampOffset !== MSETimeOffset) {
                buffer.timestampOffset = MSETimeOffset;
            }
        },

        updateBufferState = function() {
            var self = this;

            // if the buffer controller is stopped and the buffer is full we should try to clear the buffer
            // before that we should make sure that we will have enough space to append the data, so we wait
            // until the video time moves forward for a value greater than rejected data duration since the last reject event or since the last seek.
            if (isQuotaExceeded && rejectedBytes && !appendingRejectedData) {
                appendingRejectedData = true;
                //try to append the data that was previosly rejected
                appendToBuffer.call(self, rejectedBytes, lastQuality).then(
                    function(){
                        appendingRejectedData = false;
                    }
                );
            } else {
                updateBufferLevel.call(self);
            }
        },

        onDataUpdateCompleted = function(sender, data, newRepresentation) {
            var self = this,
                bufferLength;

            if (deferredInitAppend && Q.isPending(deferredInitAppend.promise)) {
                deferredInitAppend.resolve();
            }

            updateBufferTimestampOffset.call(self, newRepresentation.MSETimeOffset);

            deferredInitAppend = Q.defer();
            initializationData = [];

            bufferLength = self.bufferExt.decideBufferLength(self.manifestModel.getValue().minBufferTime, self.playbackController.getPeriodDuration());
            //self.debug.log("Min Buffer time: " + bufferLength);
            if (minBufferTime !== bufferLength) {
                self.setMinBufferTime(bufferLength);
                self.notify(self.eventList.ENAME_MIN_BUFFER_TIME_UPDATED, bufferLength);
            }
        },

        onStreamCompleted = function (sender, model, request) {
            var self = this;

            if (model !== self.streamProcessor.getFragmentModel()) return;

            lastIndex = request.index;
            checkIfBufferingCompleted.call(self);
        },

        onQualityChanged = function(sender, typeValue, oldQuality, newQuality) {
            if (type !== typeValue) return;

            var self = this;

            // if the quality has changed we should append the initialization data again. We get it
            // from the cached array instead of sending a new request
            if (lastQuality === newQuality) return;

            updateBufferTimestampOffset.call(self, self.representationController.getRepresentationForQuality(newQuality).MSETimeOffset);

            lastQuality = newQuality;
            switchInitData.call(self);
        },

        switchInitData = function() {
            var self = this;

            deferredInitAppend = Q.defer();
            if (initializationData[lastQuality]) {
                appendToBuffer.call(self, initializationData[lastQuality], lastQuality).then(
                    function() {
                        deferredInitAppend.resolve();
                    }
                );
            } else {
                // if we have not loaded the init segment for the current quality, do it
                self.notify(self.eventList.ENAME_INIT_REQUESTED, lastQuality);
            }
        },

        onPlaybackRateChanged = function(/*sender*/) {
            checkIfSufficientBuffer.call(this);
        },

        onScheduledTimeOccurred = function(sender, model) {
            var self = this;

            if (type !== model.getContext().streamProcessor.getType()) return;

            checkIfSufficientBuffer.call(self);
        };

    return {
        manifestExt: undefined,
        manifestModel: undefined,
        bufferExt: undefined,
        sourceBufferExt: undefined,
        debug: undefined,
        system: undefined,
        eventList: undefined,
        notify: undefined,
        subscribe: undefined,
        unsubscribe: undefined,

        setup: function() {
            this.dataUpdateCompleted = onDataUpdateCompleted;

            this.initSegmentLoaded = onInitializationLoaded;
            this.mediaSegmentLoaded =  onMediaLoaded;
            this.streamCompleted = onStreamCompleted;

            this.scheduledTimeOccurred = onScheduledTimeOccurred;
            this.qualityChanged = onQualityChanged;

            this.playbackProgress = updateBufferState;
            this.playbackSeeking = updateBufferState;
            this.playbackTimeUpdated = updateBufferState;
            this.playbackRateChanged = onPlaybackRateChanged;
        },

        initialize: function (typeValue, buffer, source, streamProcessor) {
            var self = this;

            type = typeValue;
            self.setMediaSource(source);
            self.setBuffer(buffer);
            self.streamProcessor = streamProcessor;
            self.fragmentController = streamProcessor.fragmentController;
            self.scheduleController = streamProcessor.scheduleController;
            self.representationController = streamProcessor.representationController;
            self.playbackController = streamProcessor.playbackController;
        },

        getStreamProcessor: function() {
            return this.streamProcessor;
        },

        setStreamProcessor: function(value) {
            this.streamProcessor = value;
        },

        getBuffer: function () {
            return buffer;
        },

        setBuffer: function (value) {
            buffer = value;
        },

        getBufferLevel: function() {
            return bufferLevel;
        },

        getMinBufferTime: function () {
            return minBufferTime;
        },

        setMinBufferTime: function (value) {
            minBufferTime = value;
        },

        setMediaSource: function(value) {
            mediaSource = value;
        },

        isBufferingCompleted : function() {
            return isBufferingCompleted;
        },

        reset: function(errored) {
            var self = this,
                cancel = function cancelDeferred(d) {
                    if (d) {
                        d.reject();
                        d = null;
                    }
                };

            cancel(deferredInitAppend);
            cancel(deferredRejectedDataAppend);
            cancel(deferredBuffersFlatten);
            deferredAppends.forEach(cancel);
            deferredAppends = [];
            cancel(deferredStreamComplete);
            deferredStreamComplete = Q.defer();

            initializationData = [];
            isQuotaExceeded = false;
            rejectedBytes = null;
            appendingRejectedData = false;
            hasSufficientBuffer = null;

            if (!errored) {
                self.sourceBufferExt.abort(mediaSource, buffer);
                self.sourceBufferExt.removeSourceBuffer(mediaSource, buffer);
            }

            buffer = null;
        }
    };
};

MediaPlayer.dependencies.BufferController.prototype = {
    constructor: MediaPlayer.dependencies.BufferController
};
