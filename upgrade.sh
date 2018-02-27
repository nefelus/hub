#!/bin/bash

if [ "$1" == "-n" ]; then
  dryrun=1
else
  dryrun=0
fi

user="nefelus"
group="nefelus"

INSTALL_BASE_PATH="/usr/share/nefelus"
INSTALL_DIR="hub"

DIRS="lib"
OTHERFILES="LICENSE.txt startup.sh nefelus-hub.conf"
SRCFILES="hub.js nef-com.js nef-hub.js nef.js package.json sqlTemplates.js ./lib/clouds.js ./lib/dict.js ./lib/dns.js ./lib/images.js ./lib/licsigner.js ./lib/logging.js ./lib/machines.js ./lib/nslmlib.js ./lib/quotas.js ./lib/quotashares.js ./lib/secgroups.js ./lib/shares.js ./lib/toolapps.js ./lib/tools.js" 

cuser=`id -un`
cgroup=`id -un`

if [ "$cuser" != "$user" ]; then
  echo "Installation script should be run as $user"
  exit 1;
fi

function mycp() {
  if [ -w $2 ]; then
    cmp $1 $2
    if [ $? != 0 ]; then
      if [ $dryrun == 0 ]; then
        cp -f $1 $2
      else
        diff -wq $1 $2
      fi
    fi
  else
    if [ $dryrun == 0 ]; then
      cp -f $1 $2
    else
      echo "$1 does not exist"
    fi
  fi
}

GCC=`find /opt/rh -name gcc -type f 2>&-`
GPP=`find /opt/rh -name g++ -type f 2>&-`

if [ -d $INSTALL_BASE_PATH/$INSTALL_DIR ]; then

  for i in `echo $DIRS | tr ' ' '\n'`; do 
    mkdir -p $i
  done
  for i in `echo $SRCFILES | tr ' ' '\n'`; do 
    mycp "$i" "$INSTALL_BASE_PATH/$INSTALL_DIR/$i"
  done

  for i in `echo $OTHERFILES | tr ' ' '\n'`; do 
    mycp "$i" "$INSTALL_BASE_PATH/$INSTALL_DIR/$i"
  done

  if [ $dryrun == 0 ]; then
    cd $INSTALL_BASE_PATH/$INSTALL_DIR
    if [ -n "$GCC" ]; then
      CC="$GCC" CXX="$GPP" npm install 
    else 
      npm install 
    fi
    echo "Restart nefelus-hub service"
  fi

else
  echo "$INSTALL_BASE_PATH/$INSTALL_DIR does not exist"
fi

exit;
