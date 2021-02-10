/**
 * A SourceBuffer implementation for Draco Mesh data.
 * 
 * @link https://developer.mozilla.org/en-US/docs/Web/API/MediaSource
 * @param {Object} canvas HTMLCanvas object
 * @param {Object} mimeType mimeType of the source mesh
 * @class MeshSourceBuffer
 */
class MeshSourceBuffer {
    constructor(mimeType) {
        // byte arrays queued to be appended
        this.buffer_ = [];

        // the total number of queued bytes
        this.bufferSize_ = 0;

        // to be able to determine the correct position to seek to, we
        // need to retain information about the mapping between the
        // media timeline and PTS values
        this.basePtsOffset_ = NaN;

        this.audioBufferEnd_ = NaN;
        this.videoBufferEnd_ = NaN;

        // indicates whether the asynchronous continuation of an operation
        // is still being processed
        // see https://w3c.github.io/media-source/#widl-SourceBuffer-updating
        this.updating = false;
        this.timestampOffset_ = 0;

        this.bytesReceived = 0;

        this.ranges = [];
        this.samples = [];

        this.mp4Parser = MP4Box.createFile();
        this.mp4Parser.onReady = (info) => {
            this.mp4Parser.setExtractionOptions(info.tracks[0].id, null, {nbSamples: 1});
            this.mp4Parser.onSamples = this.onSamples.bind(this);
            this.mp4Parser.start();
        }

        Object.defineProperty(this, 'timestampOffset', {
            get() {
                return this.timestampOffset_;
            },
            set(val) {
                if (typeof val === 'number' && val >= 0) {
                    this.timestampOffset_ = val;
                }
            }
        });

        Object.defineProperty(this, 'buffered', {
            get() {
                const ranges = [...this.ranges];
                // The buffered read-only property of the SourceBuffer interface returns the time ranges that are currently buffered in the SourceBuffer as a normalized TimeRanges object.
                return {
                    length: ranges.length,
                    start: function(i) { return ranges[i].start; },
                    end: function(i) { return ranges[i].end; }
                };
            }
        });
    }


    async onSamples(id, user, [sample]) {
        const {dts, duration, timescale} = sample;

        // Re-compute 'ranges'
        let start = dts / timescale;
        let delta = duration / timescale;
        let end = start + delta;
        if (this.ranges.length === 0) {
            // Add the first range entry
            this.ranges.push({start, end})
        } else {
            let ridx = this.ranges.length - 1
            // Either extend the current range or add a new one;
            if (start > this.ranges[ridx].end + delta * 2) {
                this.ranges.push({start, end})
            } else {
                this.ranges[ridx].end = end;
            }
        }
    }

    /**
     * Append bytes to the sourcebuffers buffer.
     *
     * @link https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/appendBuffer
     * @param {Array} bytes
     */
    appendBuffer(bytes) {
        let error;

        if (this.updating) {
            error = new Error('SourceBuffer.append() cannot be called ' +
                'while an update is in progress');
            error.name = 'InvalidStateError';
            error.code = 11;
            throw error;
        }
        bytes.fileStart = this.bytesReceived;
        this.mp4Parser.appendBuffer(bytes);
        this.bytesReceived += bytes.byteLength;
    }

    getFrameDuration() {
        return this.frameDuration;
    }

    /**
     * Reset the parser and remove any data queued to be sent decoder.
     *
     * @link https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/abort
     */
    abort() {
        this.buffer_ = [];
        this.bufferSize_ = 0;

        // report any outstanding updates have ended
        if (this.updating) {
            this.updating = false;
        }
    }

    /**
     * Remove mesh within the given time range.
     *
     * @link https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/remove
     * @param {Double} start start of the section to remove
     * @param {Double} end end of the section to remove
     */
    remove(start, end) {

    }
}

let initialized = false;
let isFallback = false;

let sourceAddedCb

function meshPolyfill(sourceAdded) {
    // Use a polyfill on the video's MediaSource API to intercept calls to addSourceBuffer
    const addSourceBuffer = window.MediaSource.prototype.addSourceBuffer;
    window.MediaSource.prototype.addSourceBuffer = function(...varArgs) {
        let mimeType = varArgs[0];
        if (mimeType === "mesh/fb;codecs=\"draco.514\"") {
            let meshSourceBuffer = new MeshSourceBuffer(varArgs);
            if (typeof sourceAddedCb === 'function') sourceAddedCb(meshSourceBuffer);
            return meshSourceBuffer;
        } else {
            return addSourceBuffer.apply(this, varArgs);
        }
    }

    const isTypeSupported = window.MediaSource.isTypeSupported;
    window.MediaSource.isTypeSupported = function(codec) {
        if (codec === "mesh/fb;codecs=\"draco.514\"") {
            return true;
        } else {
            return isTypeSupported(codec);
        }
    }
}

meshPolyfill();
