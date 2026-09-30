#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

/* Repository test-only meter. wait4 includes a waited child and descendants
 * that child waited for on Linux and macOS. It is not shipped in the product. */
static long long micros(struct timeval value) {
  return (long long)value.tv_sec * 1000000LL + value.tv_usec;
}

int main(int argc, char **argv) {
  if (argc < 4 || strcmp(argv[1], "--cpu-report") != 0) {
    fprintf(stderr, "usage: cpu-supervisor --cpu-report PATH COMMAND [ARG...]\n");
    return 125;
  }
  const char *report = argv[2];
  pid_t child = fork();
  if (child < 0) { perror("fork"); return 125; }
  if (child == 0) {
    execvp(argv[3], argv + 3);
    perror("execvp");
    _exit(127);
  }

  struct rusage child_usage;
  int status = 0;
  pid_t waited;
  do { waited = wait4(child, &status, 0, &child_usage); }
  while (waited < 0 && errno == EINTR);
  if (waited != child) { perror("wait4"); return 125; }

  struct rusage self_usage;
  if (getrusage(RUSAGE_SELF, &self_usage) != 0) { perror("getrusage"); return 125; }
  long long user_us = micros(child_usage.ru_utime) + micros(self_usage.ru_utime);
  long long system_us = micros(child_usage.ru_stime) + micros(self_usage.ru_stime);
  int fd = open(report, O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (fd < 0) { perror("open cpu report"); return 125; }
  char output[160];
  int length = snprintf(output, sizeof(output), "{\"userUs\":%lld,\"systemUs\":%lld}\n", user_us, system_us);
  if (length < 0 || length >= (int)sizeof(output) || write(fd, output, (size_t)length) != length || close(fd) != 0) {
    fprintf(stderr, "failed to write CPU report\n");
    return 125;
  }
  if (WIFEXITED(status)) { return WEXITSTATUS(status); }
  if (WIFSIGNALED(status)) { return 128 + WTERMSIG(status); }
  return 125;
}
