const { Number } = require('../../server/protos/numbers_pb')

module.exports = jsonObj => {
  const number = new Number()
  const location = jsonObj.spec.location
  number.setRef(jsonObj.metadata.ref)
  number.setProviderRef(jsonObj.metadata.gwRef)
  number.setIngressApp(jsonObj.metadata.ingressApp)
  number.setCreateTime(jsonObj.metadata.createdOn)
  number.setUpdateTime(jsonObj.metadata.modifiedOn)
  number.setE164Number(location.telUrl.split(':')[1])

  return number
}
