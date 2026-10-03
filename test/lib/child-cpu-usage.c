#include <node_api.h>
#include <sys/resource.h>

/* RUSAGE_CHILDREN includes each reaped child's waited descendants. Calling
 * this in the test worker measures its commands, rather than a sampling
 * subprocess's children. It deliberately excludes unrelated host processes. */
static napi_value usage(napi_env env, napi_callback_info info) {
  (void)info;
  struct rusage value;
  if (getrusage(RUSAGE_CHILDREN, &value) != 0) {
    napi_throw_error(env, NULL, "getrusage(RUSAGE_CHILDREN) failed");
    return NULL;
  }
  double micros = (double)value.ru_utime.tv_sec * 1000000 + value.ru_utime.tv_usec
    + (double)value.ru_stime.tv_sec * 1000000 + value.ru_stime.tv_usec;
  napi_value result;
  napi_create_double(env, micros, &result);
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value function;
  napi_create_function(env, "waitedChildCpuUs", NAPI_AUTO_LENGTH, usage, NULL, &function);
  napi_set_named_property(env, exports, "waitedChildCpuUs", function);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
