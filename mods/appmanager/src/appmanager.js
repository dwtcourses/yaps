const tar = require('tar')
const fs = require('fs-extra')
const path = require('path')
const { grpc } = require('@yaps/core')
const { logger } = require('@yaps/core')
const { Storage } = require('@yaps/storage')
const { appManagerValidator } = require('@yaps/core').validators
const { getClientCredentials } = require('@yaps/core').trust_util
const { promisifyAll } = require('grpc-promise')
const { YAPSService, AppManagerService, AppManagerPB } = require('@yaps/core')

const STATUS = {
  UNKNOWN: 0,
  CREATING: 1,
  RUNNING: 2,
  STOPPED: 3
}

/**
 * @classdesc Use YAPS AppManager, a capability of YAPS Systems Manager,
 * to create, manage, and deploy an applications. YAPS AppManager requires of a
 * running YAPS deployment.
 *
 * @extends YAPSService
 * @example
 *
 * const YAPS = require('@yaps/sdk')
 * const appManager = new YAPS.AppManager()
 *
 * appManager.deployApp('/path/to/app')
 * .then(result => {
 *   console.log(result)             // successful response
 * }).catch(e => console.error(e))   // an error occurred
 */
class AppManager extends YAPSService {
  /**
   * Application object
   *
   * @typedef {Object} App
   * @property {App.Status} status - Current status of the application.
   * @property {string} name - A name, globally unique, for the application.
   * @property {string} description - A description for the application.
   * @property {number} createTime - Time the application was created.
   * @property {number} updateTime - Last time the application was updated.
   * @property {map} labels - Metadata for this application.
   */

  /**
   * Constructs a new AppManager Object.
   *
   * @see module:core:YAPSService
   */
  constructor (options) {
    super(options, AppManagerService.AppManagerClient)
    this.storage = new Storage(super.getOptions())
    this.service = super.getService()
    promisifyAll(super.getService(), { metadata: super.getMeta() })
  }

  /**
   * Deploys an application to YAPS.
   *
   * @param {string} path - path to the application
   * @return {Promise<App>} The application just created
   * @throws if path to application does not exist or is not a directory
   * @throws the file package.json does not exist inside de application path
   * @throws the file package.json is missing the name or description
   * @example
   *
   * const path = '/path/to/project'
   *
   * appManager.deployApp(path)
   * .then(result => {
   *   console.log(result)            // returns the app object
   * }).catch(e => console.error(e))   // an error occurred
   *
   * @todo if the file uploading fails the state of the application should
   * change to UNKNOWN.
   */
  async deployApp (appPath) {
    logger.log('verbose', `@yaps/appmananger deployApp [path -> ${appPath}]`)
    logger.log('debug', '@yaps/appmananger deployApp [validating app]')
    logger.log('debug', '@yaps/appmananger deployApp [getting package info]')

    try {
      const packagePath = path.join(appPath, 'package.json')
      // Expects an existing valid package.json
      const packageInfo = p => JSON.parse(fs.readFileSync(p))
      let pInfo

      try {
        pInfo = packageInfo(packagePath)
        logger.log(
          'debug',
          `@yaps/appmananger deployApp [package info -> ${JSON.stringify(
            pInfo
          )}]`
        )
      } catch (err) {
        console.log(err)
        throw new Error(
          `Unable to obtain project info. Ensure package.json exists in '${appPath}', and that is well formatted`
        )
      }

      let bucket = 'default'

      try {
        const yapsConfigFile = await fs.readFileSync(
          path.join(appPath, 'yaps.json')
        )
        const yapsConfig = JSON.parse(yapsConfigFile)
        bucket = yapsConfig.bucket
      } catch (e) {}

      const request = {
        dirPath: appPath,
        app: {
          name: pInfo.name,
          description: pInfo.description,
          bucket: bucket
        }
      }

      logger.log(
        'debug',
        `@yaps/appmananger deployApp [modified request -> ${JSON.stringify(
          request
        )} ]`
      )

      // WARNING: I'm not happy with this. Seems inconsistent with the other
      // errors...
      const errors = appManagerValidator.createAppRequest.validate({
        app: {
          name: request.app.name,
          description: request.app.description
        }
      })

      if (errors.length > 0) {
        logger.log('warn', `@yaps/appmananger deployApp [invalid argument/s]`)
        throw new Error(
          'Please ensure package.json contains the name and description fields'
        )
      }

      if (
        !fs.existsSync(request.dirPath) ||
        !fs.lstatSync(request.dirPath).isDirectory()
      ) {
        throw new Error(
          `${request.dirPath} does not exist or is not a directory`
        )
      }

      if (!fs.existsSync(packagePath)) {
        throw new Error(`not package.json found in ${request.dirPath}`)
      }

      logger.log('debug', '@yaps/appmananger deployApp [registering app]')

      const app = new AppManagerPB.App()
      app.setName(request.app.name)
      app.setDescription(request.app.description)
      app.setBucket(request.app.bucket)

      const createAppRequest = new AppManagerPB.CreateAppRequest()
      createAppRequest.setApp(app)

      const response = await this.service
        .createApp()
        .sendMessage(createAppRequest)

      // TODO: Validate that the name is lower case and has no spaces
      const dirName = `${request.app.name}`
      await fs.copy(request.dirPath, `/tmp/${dirName}`)

      logger.log(
        'debug',
        `@yaps/appmananger deployApp [copyed '${
          request.dirPath
        }' into '/tmp/${dirName}'}]`
      )
      logger.log(
        'debug',
        '@yaps/appmananger deployApp [archiving project folder]'
      )

      await tar.create({ file: `/tmp/${dirName}.tgz`, cwd: '/tmp' }, [dirName])

      // Will fail because of bad argument filenam
      await this.storage.uploadObject({
        filename: `/tmp/${dirName}.tgz`,
        bucket: 'apps' // TODO: Maybe I should place this in the .env
      })

      return response
    } catch (e) {
      throw e
    }
  }

  /**
   * Retrives an application by name.
   *
   * @param {string} name - The name of the application
   * @return {Promise<App>} The application
   * @throws if name is null or application does not exist
   * @example
   *
   * appManager.getApp(name)
   * .then(result => {
   *   console.log(result)             // returns the app object
   * }).catch(e => console.error(e))   // an error occurred
   */
  async getApp (name) {
    const request = new AppManagerPB.GetAppRequest()
    request.setName(name)
    return this.service.getApp().sendMessage(request)
  }

  /**
   * Deletes an application already registered in YAPS.
   *
   * @param {string} name - The name of the application
   * @return {Promise<App>} The application to remove
   * @throws if the application is not found
   * @example
   *
   * appManager.deleteApp(name)
   * .then(() => {
   *   console.log('finished')        // returns an empty object
   * }).catch(e => console.error(e))  // an error occurred
   */
  async deleteApp (name) {
    const request = new AppManagerPB.DeleteAppRequest()
    request.setName(name)
    return this.service.deleteApp().sendMessage(request)
  }

  /**
   * List the applications registered in YAPS.
   *
   * @param {Object} request
   * @param {number} request.pageSize - Number of element per page
   * (defaults to 20)
   * @param {string} request.pageToken - The next_page_token value returned from
   * a previous List request, if any
   * @return {Promise<ListAppsResponse>} List of applications
   * @example
   *
   * const request = {
   *    pageSize: 20,
   *    pageToken: 2
   * }
   *
   * appManager.listApps(request)
   * .then(result => {
   *   console.log(result)            // returns a ListAppsResponse
   * }).catch(e => console.error(e))  // an error occurred
   */
  async listApps (request) {
    logger.log(
      'verbose',
      `@yaps/appmananger listApps [request -> ${JSON.stringify(request)}]`
    )
    const r = new AppManagerPB.ListAppsRequest()
    r.setPageSize(request.pageSize)
    r.setPageToken(request.pageToken)
    r.setView(request.view)
    return this.service.listApps().sendMessage(r)
  }

  static get STATES () {
    return STATES
  }
}

module.exports = AppManager
