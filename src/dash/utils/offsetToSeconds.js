import moment from 'moment';

export function offsetToSeconds(timeOffset) {
    if (timeOffset && timeOffset.includes('P')) {
        return moment.duration(timeOffset).asSeconds();
    }
    return timeOffset
}
