const axios = require('axios')

export class HttpClient {
    public static sendRequest(targetUrl, data) {
        return axios({
            method: 'post',
            url: targetUrl,
            data: data
        })
    }
}  