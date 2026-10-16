package com.rayzeng.mocapstudio;

import android.Manifest;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "MoCapCamera", permissions = {
 @Permission(alias="camera", strings={Manifest.permission.CAMERA})
})
public class MoCapCameraPlugin extends Plugin {
 @PluginMethod public void requestCamera(PluginCall call){
  if(getPermissionState("camera") == PermissionState.GRANTED){call.resolve();return;}
  requestPermissionForAlias("camera", call, "cameraPermissionCallback");
 }
 @PermissionCallback private void cameraPermissionCallback(PluginCall call){
  if(getPermissionState("camera") == PermissionState.GRANTED)call.resolve();
  else call.reject("Доступ к камере отклонён. Разреши камеру в настройках Android.");
 }
}
