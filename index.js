/**
 * Copyright (c) 2018-present, Wonday (@wonday.org)
 * All rights reserved.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 */
"use strict";
import { Image, ImageBackground, Platform, View } from "react-native";
import React, { Component } from "react";
import RNFetchBlob from "rn-fetch-blob";
const SHA1 = require("crypto-js/sha1");
const defaultImageTypes = ["png", "jpeg", "jpg", "gif", "bmp", "tiff", "tif"];
const defaultRetry = { count: 3, interval: 100 };
export default class CachedImage extends Component {
  static defaultProps = {
    expiration: 86400 * 7, // default cache a week
    activityIndicator: null, // default not show an activity indicator
    defaultRetry, // default prefetch retry
  };
  static cacheDir = RNFetchBlob.fs.dirs.CacheDir + "/CachedImage/";
  static sameURL = [];
  /**
   * delete a cache file
   * @param url
   */
  static deleteCache = (url) => {
    const cacheFile = _getCacheFilename(url);
    return _unlinkFile(cacheFile);
  };
  /**
   * clear all cache files
   */
  static clearCache = () => _unlinkFile(CachedImage.cacheDir);
  /**
   * check if a url is cached
   */
  static isUrlCached = (url: string, success: Function, failure: Function) => {
    const cacheFile = _getCacheFilename(url);
    RNFetchBlob.fs
      .exists(cacheFile)
      .then((exists) => {
        success && success(exists);
      })
      .catch((error) => {
        failure && failure(error);
      });
  };
  /**
   * make a cache filename
   * @param url
   * @returns {string}
   */
  static getCacheFilename = (url) => {
    return _getCacheFilename(url);
  };
  /**
   * Same as ReactNaive.Image.getSize only it will not download the image if it has a cached version
   * @param url
   * @param success callback (width,height)=>{}
   * @param failure callback (error:string)=>{}
   * @param retry object {count:number, interval:number}
   */
  static getSize = (
    url: string,
    success: Function,
    failure: Function,
    retry: Object = defaultRetry
  ) => {
    CachedImage.prefetch(
      url,
      0,
      (cacheFile) => {
        if (Platform.OS === "android") {
          url = "file://" + cacheFile;
        } else {
          url = cacheFile;
        }
        Image.getSize(url, success, failure);
      },
      (error) => {
        Image.getSize(url, success, failure);
      },
      retry
    );
  };
  /**
   * prefech an image
   *
   * @param url
   * @param expiration if zero or not set, no expiration
   * @param success callback (cacheFile:string)=>{}
   * @param failure callback (error:string)=>{}
   * @param retry object {count:number, interval:number}
   */
  static prefetch = (
    url: string,
    expiration: number,
    success: Function,
    failure: Function,
    retry: Object = defaultRetry
  ) => {
    // source invalidate
    if (!url || url.toString() !== url) {
      failure && failure("no url.");
      return;
    }
    const cacheFile = _getCacheFilename(url);
    function checkCached(exists) {
      if (exists) {
        success && success(cacheFile);
      } else {
        if (retry.count > 0) {
          --retry.count;
          setTimeout(() => {
            CachedImage.prefetch(url, expiration, success, failure, retry);
          }, retry.interval);
        } else {
          failure && failure("same url fetch timeout.");
        }
      }
    }
    if (CachedImage.sameURL.includes(cacheFile)) {
      // Check to see if the cacheFile exists yet (download may be in progress).
      CachedImage.isUrlCached(url, checkCached, failure);
      return;
    }
    CachedImage.sameURL.push(cacheFile);
    RNFetchBlob.fs
      .stat(cacheFile)
      .then((stats) => {
        // if exist and not expired then use it.
        if (!Boolean(expiration) || expiration * 1000 + stats.lastModified > new Date().getTime()) {
          success && success(cacheFile);
        } else {
          _saveCacheFile(url, success, failure);
        }
      })
      .catch((error) => {
        // not exist
        _saveCacheFile(url, success, failure);
      });
  };
  constructor(props) {
    super(props);
    this.state = {
      source: null,
    };
    this._useDefaultSource = false;
    this._downloading = false;
    this._mounted = false;
  }
  componentDidMount() {
    this._mounted = true;
  }
  componentDidUpdate(nextProps) {
    const { source } = nextProps;
    if (source !== this.props.source) {
      this.setState({ ...this.props, source: source });
    }
  }
  componentWillUnmount() {
    this._mounted = false;
  }
  render() {
    if (this.props.source && this.props.source.uri) {
      if (!this.state.source && !this._downloading) {
        this._downloading = true;
        CachedImage.prefetch(
          this.props.source.uri,
          this.props.expiration,
          (cacheFile) => {
            setTimeout(() => {
              //   if (this._mounted) {
              //     this.setState({ source: { uri: "file://" + cacheFile } });
              //   }
              this._downloading = false;
            }, 0);
          },
          (error) => {
            // cache failed use original source
            if (this._mounted) {
              setTimeout(() => {
                this.setState({ source: { uri: this.props.source.uri } });
              }, 0);
            }
            this._downloading = false;
          },
          this.props.retry
        );
      }
    } else {
      this.state.source = this.props.source;
    }
    if (this.state.source) {
      const renderImage = (props, children) => {
        return children != null ? (
          <ImageBackground {...props}>{children}</ImageBackground>
        ) : (
          <Image {...props} />
        );
      };
      const result = renderImage(
        {
          ...this.props,
          source: this.state.source,
          onError: (error) => {
            // error happened, delete cache
            if (this.props.source && this.props.source.uri) {
              CachedImage.deleteCache(this.props.source.uri);
            }
            if (this.props.onError) {
              this.props.onError(error);
            } else {
              if (!this._useDefaultSource && this.props.defaultSource) {
                this._useDefaultSource = true;
                setTimeout(() => {
                  if (this.props.source && this.props.source.uri) {
                    this.setState({ source: this.props.source });
                  } else this.setState({ source: this.props.defaultSource });
                }, 0);
              }
            }
          },
        },
        this.props.children
      );
      return result;
    } else {
      return (
        <View
          {...this.props}
          style={
            this.props.style
              ? [
                  this.props.style,
                  {
                    alignItems: "center",
                    justifyContent: "center",
                  },
                ]
              : { alignItems: "center", justifyContent: "center" }
          }
        >
          {this.props.activityIndicator}
        </View>
      );
    }
  }
}
async function _unlinkFile(file) {
  try {
    return await RNFetchBlob.fs.unlink(file);
  } catch (e) {}
}
/**
 * make a cache filename
 * @param url
 * @returns {string}
 */
function _getCacheFilename(url) {
  const isBase64 = !!(url && url.match(/^data:/));
  if (!url || url.toString() !== url) return "";
  let ext = isBase64 ? url.split(";")[0].split("/")[1] : url.replace(/.+\./, "").toLowerCase();
  if (isBase64 && ext === "jpeg") {
    ext = "jpg";
  }
  if (defaultImageTypes.indexOf(ext) === -1) ext = "png";
  let hash = SHA1(url);
  return CachedImage.cacheDir + hash + "." + ext;
}
/**
 * save a url or base64 data to local file
 *
 *
 * @param url
 * @param success callback (cacheFile:string)=>{}
 * @param failure callback (error:string)=>{}
 */
async function _saveCacheFile(url: string, success: Function, failure: Function) {
  try {
    const isNetwork = !!(url && url.match(/^https?:\/\//));
    const isLocal = !!(url && url.match(/^file?:\/\//));
    const isBase64 = !!(url && url.match(/^data:/));
    const cacheFile = _getCacheFilename(url, isBase64);
    if (isNetwork || isLocal) {
      const tempCacheFile = cacheFile + ".tmp";
      _unlinkFile(tempCacheFile);
      RNFetchBlob.config({
        // response data will be saved to this path if it has access right.
        path: tempCacheFile,
      })
        .fetch("GET", url)
        .then(async (res) => {
          if (
            res &&
            res.respInfo &&
            res.respInfo.headers &&
            !res.respInfo.headers["Content-Encoding"] &&
            !res.respInfo.headers["Transfer-Encoding"] &&
            res.respInfo.headers["Content-Length"]
          ) {
            const expectedContentLength = res.respInfo.headers["Content-Length"];
            let actualContentLength;
            try {
              const fileStats = await RNFetchBlob.fs.stat(res.path());
              if (!fileStats || !fileStats.size) {
                throw new Error("FileNotFound:" + url);
              }
              actualContentLength = fileStats.size;
            } catch (error) {
              throw new Error("DownloadFailed:" + url);
            }
            if (expectedContentLength != actualContentLength) {
              throw new Error("DownloadFailed:" + url);
            }
          }
          _unlinkFile(cacheFile);
          RNFetchBlob.fs
            .mv(tempCacheFile, cacheFile)
            .then(() => {
              success && success(cacheFile);
            })
            .catch(async (error) => {
              throw error;
            });
        })
        .catch(async (error) => {
          _unlinkFile(tempCacheFile);
          _unlinkFile(cacheFile);
          failure && failure(error);
        });
    } else if (isBase64) {
      let data = url.replace(/data:/i, "");
      RNFetchBlob.fs
        .writeFile(cacheFile, data, "base64")
        .then(() => {
          success && success(cacheFile);
        })
        .catch(async (error) => {
          _unlinkFile(cacheFile);
          failure && failure(error);
        });
    } else {
      failure && failure(new Error("NotSupportedUrl"));
    }
  } catch (error) {
    failure && failure(error);
  }
}

